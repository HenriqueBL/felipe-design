import "server-only";

import { z } from "zod";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/services/auth";

export type StripeConfigMode = "test" | "live";

// Runtime configuration consumed by the payment provider. Server-only:
// the decrypted secrets NEVER leave this module (except into the Stripe SDK).
export interface StripeRuntimeConfiguration {
  mode: StripeConfigMode;
  secretKey: string;
  webhookSecret: string;
}

// Safe status for the admin UI. Contains no secret material.
export interface StripeAdminStatus {
  mode: StripeConfigMode;
  secretKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  secretKeyLast4: string | null;
  lastWebhookVerifiedAt: string | null;
  updatedAt: string | null;
}

export class StripeConfigError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Stripe configuration error: " + code);
    this.name = "StripeConfigError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const stripeConfigSchema = z
  .object({
    mode: z.enum(["test", "live"]),
    // Empty string (form field left blank) means "preserve existing secret".
    secretKey: z.string().trim().max(200),
    webhookSecret: z.string().trim().max(200),
  })
  .refine(
    (data) => data.secretKey === "" || /^sk_(test|live)_[A-Za-z0-9_]+$/.test(data.secretKey),
    { message: "Invalid secret key format.", path: ["secretKey"] },
  )
  .refine(
    (data) => data.webhookSecret === "" || /^whsec_[A-Za-z0-9_]+$/.test(data.webhookSecret),
    { message: "Invalid webhook signing secret format.", path: ["webhookSecret"] },
  )
  .refine(
    (data) =>
      data.secretKey === "" ||
      (data.mode === "test" ? data.secretKey.startsWith("sk_test_") : data.secretKey.startsWith("sk_live_")),
    { message: "Secret key does not match the selected mode.", path: ["secretKey"] },
  );

export function validateStripeSecretFormat(
  mode: StripeConfigMode,
  secretKey: string,
  webhookSecret: string,
): { ok: true } | { ok: false; reason: "MODE_MISMATCH" | "INVALID_KEY" | "INVALID_WEBHOOK" } {
  if (secretKey.length > 0) {
    if (!/^sk_(test|live)_[A-Za-z0-9_]+$/.test(secretKey)) {
      return { ok: false, reason: "INVALID_KEY" };
    }
    if (mode === "test" && !secretKey.startsWith("sk_test_")) {
      return { ok: false, reason: "MODE_MISMATCH" };
    }
    if (mode === "live" && !secretKey.startsWith("sk_live_")) {
      return { ok: false, reason: "MODE_MISMATCH" };
    }
  }
  if (webhookSecret.length > 0 && !/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret)) {
    return { ok: false, reason: "INVALID_WEBHOOK" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Runtime configuration (provider source of truth)
// ---------------------------------------------------------------------------

// Short-lived cache: a new admin configuration is picked up without a
// container restart, without paying a Vault read on every payment call.
const RUNTIME_CACHE_TTL_MS = 10_000;

let cachedRuntime: { value: StripeRuntimeConfiguration | null; fetchedAt: number } | null = null;

export function resetStripeRuntimeCacheForTests(): void {
  cachedRuntime = null;
}

function adminClient() {
  return createSupabaseAdminClient();
}

async function fetchRuntimeConfiguration(): Promise<StripeRuntimeConfiguration | null> {
  const { data, error } = await adminClient().rpc("get_stripe_runtime_config");
  if (error) {
    throw new StripeConfigError("STORAGE_UNAVAILABLE");
  }
  const row = (data as { mode: string; secret_key: string; webhook_secret: string }[] | null)?.[0];
  if (!row || !row.secret_key || !row.webhook_secret) {
    return null;
  }
  return {
    mode: row.mode === "live" ? "live" : "test",
    secretKey: row.secret_key,
    webhookSecret: row.webhook_secret,
  };
}

export async function getStripeRuntimeConfiguration(): Promise<StripeRuntimeConfiguration | null> {
  const now = Date.now();
  if (cachedRuntime && now - cachedRuntime.fetchedAt < RUNTIME_CACHE_TTL_MS) {
    return cachedRuntime.value;
  }
  const value = await fetchRuntimeConfiguration();
  cachedRuntime = { value, fetchedAt: now };
  return value;
}

// ---------------------------------------------------------------------------
// Admin operations (server-side only; role checked against profiles)
// ---------------------------------------------------------------------------

async function requireAdminUserId(): Promise<string> {
  if (!(await isAdminUser())) {
    throw new StripeConfigError("FORBIDDEN");
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.id) {
    throw new StripeConfigError("FORBIDDEN");
  }
  return data.user.id;
}

export async function getStripeAdminStatus(): Promise<StripeAdminStatus> {
  await requireAdminUserId();

  const { data, error } = await adminClient().rpc("get_stripe_admin_status");
  if (error) {
    throw new StripeConfigError("STORAGE_UNAVAILABLE");
  }
  const row = (data as Record<string, unknown>[] | null)?.[0];
  return {
    mode: row?.mode === "live" ? "live" : "test",
    secretKeyConfigured: Boolean(row?.secret_key_configured),
    webhookSecretConfigured: Boolean(row?.webhook_secret_configured),
    secretKeyLast4: typeof row?.secret_key_last4 === "string" ? row.secret_key_last4 : null,
    lastWebhookVerifiedAt:
      typeof row?.last_webhook_verified_at === "string" ? row.last_webhook_verified_at : null,
    updatedAt: typeof row?.updated_at === "string" ? row.updated_at : null,
  };
}

export interface UpdateStripeConfigurationInput {
  mode: StripeConfigMode;
  secretKey: string;
  webhookSecret: string;
}

export async function updateStripeConfiguration(
  input: UpdateStripeConfigurationInput,
): Promise<void> {
  const userId = await requireAdminUserId();

  const format = validateStripeSecretFormat(input.mode, input.secretKey, input.webhookSecret);
  if (!format.ok) {
    throw new StripeConfigError(format.reason);
  }

  // Empty strings mean "preserve": send NULL so the RPC keeps the vault value.
  const { error } = await adminClient().rpc("update_stripe_config", {
    p_mode: input.mode,
    p_secret_key: input.secretKey.length > 0 ? input.secretKey : null,
    p_webhook_secret: input.webhookSecret.length > 0 ? input.webhookSecret : null,
    p_updated_by: userId,
  });
  if (error) {
    // Only sanitized codes; the raw message may echo argument fragments.
    if (error.message.includes("MODE_MISMATCH")) {
      throw new StripeConfigError("MODE_MISMATCH");
    }
    if (error.message.includes("INVALID_WEBHOOK")) {
      throw new StripeConfigError("INVALID_WEBHOOK");
    }
    if (error.message.includes("PARTIAL_CONFIGURATION")) {
      throw new StripeConfigError("PARTIAL_CONFIGURATION");
    }
    if (error.message.includes("INVALID_MODE")) {
      throw new StripeConfigError("INVALID_MODE");
    }
    throw new StripeConfigError("STORAGE_UNAVAILABLE");
  }

  // Invalidate cache immediately: the new configuration must be used
  // without a restart.
  cachedRuntime = null;
}

export interface StripeConnectionTestResult {
  // The API key is verified with a real (light) Stripe API call.
  apiKey: "VERIFIED" | "FAILED" | "NOT_CONFIGURED";
  // The webhook secret is only reported as configured or not; real
  // verification happens when a signed webhook arrives.
  webhookSecret: "CONFIGURED" | "NOT_CONFIGURED";
}

export async function testStripeConnection(): Promise<StripeConnectionTestResult> {
  await requireAdminUserId();

  const config = await fetchRuntimeConfiguration();
  if (!config) {
    return { apiKey: "NOT_CONFIGURED", webhookSecret: "NOT_CONFIGURED" };
  }

  // Balance endpoint: nao exige customer, nao cria objeto, valida a
  // autenticacao da conta e retorna `livemode`. Nunca loga nem retorna
  // balance/amounts — apenas sucesso/erro sanitizado.
  try {
    const response = await fetch("https://api.stripe.com/v1/balance", {
      method: "GET",
      headers: {
        Authorization: "Bearer " + config.secretKey,
      },
    });
    if (response.status !== 200) {
      return { apiKey: "FAILED", webhookSecret: "CONFIGURED" };
    }
    // Coerencia mode x chave: sk_test_ deve ter livemode=false; sk_live_,
    // livemode=true. Divergencia => FAIL seguro.
    const body = (await response.json()) as { livemode?: unknown };
    const expectedLivemode = config.mode === "live";
    if (body.livemode !== expectedLivemode) {
      return { apiKey: "FAILED", webhookSecret: "CONFIGURED" };
    }
    return { apiKey: "VERIFIED", webhookSecret: "CONFIGURED" };
  } catch {
    return { apiKey: "FAILED", webhookSecret: "CONFIGURED" };
  }
}

// Called by the webhook route AFTER a signature verifies successfully:
// the only real proof that the webhook signing secret matches Stripe.
export async function markStripeWebhookVerified(): Promise<void> {
  try {
    await adminClient().rpc("mark_stripe_webhook_verified");
  } catch {
    // Best-effort metadata: never fails webhook processing.
  }
}