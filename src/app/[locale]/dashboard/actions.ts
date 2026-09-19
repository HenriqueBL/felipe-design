"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildResultPath, validateUploadFile } from "@/domain/checkout";
import { requireEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/services/auth";
import { setOrderStatus } from "@/services/orders";
import { PlanPriceError, setPlanActive, updatePlanPrice } from "@/services/plans";
import { updateAppSettings } from "@/services/settings";
import {
  StripeConfigError,
  testStripeConnection,
  updateStripeConfiguration,
} from "@/services/stripe-config";

export interface ActionResult {
  success: boolean;
  message?: string;
}

const priceSchema = z.object({
  planId: z.string().uuid(),
  currency: z.enum(["BRL", "USD"]),
  amountCents: z.coerce.number().int().min(0).max(100_000_00),
});

const activeSchema = z.object({
  planId: z.string().uuid(),
  active: z.coerce.boolean(),
});

const statusSchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
});

const settingsSchema = z
  .object({
    dailyCapacity: z.coerce.number().int().min(1).max(1000),
    cutoffTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
    timezone: z.string().refine(
      (value) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      },
      "Invalid IANA timezone",
    ),
    minSourcePhotosPerKnife: z.coerce.number().int().min(1).max(100),
    maxSourcePhotosPerKnife: z.coerce.number().int().min(1).max(100),
    maxSourcePhotoSizeMb: z.coerce.number().int().min(1).max(200),
  })
  .refine((data) => data.maxSourcePhotosPerKnife >= data.minSourcePhotosPerKnife, {
    message: "Max photos per knife must be >= min photos per knife.",
    path: ["maxSourcePhotosPerKnife"],
  });

function safeLocale(locale: string): string {
  return locale === "pt" ? "pt" : "en";
}

export async function updatePriceAction(
  locale: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = priceSchema.safeParse({
    planId: formData.get("planId"),
    currency: formData.get("currency"),
    amountCents: formData.get("amountCents"),
  });

  if (!parsed.success) {
    return { success: false, message: "Invalid price value." };
  }

  try {
    await updatePlanPrice({
      planId: parsed.data.planId,
      currency: parsed.data.currency,
      amountCents: parsed.data.amountCents,
    });
    revalidatePath("/" + safeLocale(locale) + "/dashboard/plans");
    return { success: true, message: "Price updated." };
  } catch (error) {
    if (error instanceof PlanPriceError) {
      const messages: Record<PlanPriceError["code"], string> = {
        FORBIDDEN: "You are not allowed to update prices.",
        INVALID_AMOUNT: "Invalid price value.",
        SETTINGS_MISSING: "Server settings are unavailable. Try again later.",
        CONFLICT: "Price was modified concurrently. Reload and try again.",
        UNKNOWN: "Failed to update price. Try again.",
      };
      return { success: false, message: messages[error.code] };
    }
    return { success: false, message: "Failed to update price. Try again." };
  }
}

export async function setPlanActiveAction(
  locale: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = activeSchema.safeParse({
    planId: formData.get("planId"),
    active: formData.get("active"),
  });

  if (!parsed.success) {
    return { success: false, message: "Invalid value." };
  }

  try {
    await setPlanActive(parsed.data.planId, parsed.data.active);
    revalidatePath("/" + safeLocale(locale) + "/dashboard/plans");
    return { success: true, message: "Plan updated." };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Failed." };
  }
}

export async function setOrderStatusAction(
  locale: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = statusSchema.safeParse({
    orderId: formData.get("orderId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { success: false, message: "Invalid value." };
  }

  try {
    await setOrderStatus(parsed.data.orderId, parsed.data.status);
    revalidatePath("/" + safeLocale(locale) + "/dashboard/orders");
    revalidatePath("/" + safeLocale(locale) + "/dashboard/orders/" + parsed.data.orderId);
    return { success: true, message: "Status updated." };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Failed." };
  }
}

export async function updateSettingsAction(
  locale: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse({
    dailyCapacity: formData.get("dailyCapacity"),
    cutoffTime: formData.get("cutoffTime"),
    timezone: formData.get("timezone"),
    minSourcePhotosPerKnife: formData.get("minSourcePhotosPerKnife"),
    maxSourcePhotosPerKnife: formData.get("maxSourcePhotosPerKnife"),
    maxSourcePhotoSizeMb: formData.get("maxSourcePhotoSizeMb"),
  });

  if (!parsed.success) {
    return { success: false, message: "Invalid settings values." };
  }

  try {
    await updateAppSettings({
      dailyCapacity: parsed.data.dailyCapacity,
      cutoffTime: parsed.data.cutoffTime,
      timezone: parsed.data.timezone,
      minSourcePhotosPerKnife: parsed.data.minSourcePhotosPerKnife,
      maxSourcePhotosPerKnife: parsed.data.maxSourcePhotosPerKnife,
      maxSourcePhotoSizeMb: parsed.data.maxSourcePhotoSizeMb,
    });
    revalidatePath("/" + safeLocale(locale) + "/dashboard/settings");
    return { success: true, message: "Settings updated." };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Failed." };
  }
}

// Salva a configuracao Stripe pelo Admin. Campos de senha em branco
// preservam os segredos existentes no Vault. A resposta nunca contem
// segredo algum — apenas status/mensagens.
const stripeSettingsSchema = z.object({
  mode: z.enum(["test", "live"]),
  secretKey: z.string().max(200),
  webhookSecret: z.string().max(200),
});

export async function updateStripeSettingsAction(
  locale: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = stripeSettingsSchema.safeParse({
    mode: formData.get("mode"),
    secretKey: formData.get("secretKey") ?? "",
    webhookSecret: formData.get("webhookSecret") ?? "",
  });

  if (!parsed.success) {
    return { success: false, message: "Invalid Stripe settings." };
  }

  try {
    await updateStripeConfiguration({
      mode: parsed.data.mode,
      secretKey: parsed.data.secretKey.trim(),
      webhookSecret: parsed.data.webhookSecret.trim(),
    });
    revalidatePath("/" + safeLocale(locale) + "/dashboard/settings");
    return { success: true, message: "Stripe settings saved." };
  } catch (error) {
    if (error instanceof StripeConfigError) {
      const messages: Record<string, string> = {
        FORBIDDEN: "You are not allowed to update Stripe settings.",
        MODE_MISMATCH: "The secret key does not match the selected mode.",
        INVALID_KEY: "Invalid secret key format.",
        INVALID_WEBHOOK: "Invalid webhook signing secret format.",
        PARTIAL_CONFIGURATION: "Provide both the secret key and the webhook signing secret.",
        INVALID_MODE: "Invalid mode.",
        STORAGE_UNAVAILABLE: "Could not save. Try again later.",
      };
      return { success: false, message: messages[error.code] ?? "Could not save Stripe settings." };
    }
    return { success: false, message: "Could not save Stripe settings. Try again." };
  }
}

// Testa a chave da API Stripe com uma chamada leve a API real. O webhook
// signing secret e reportado apenas como configurado/nao configurado —
// verificacao real so ocorre com um webhook assinado.
export async function testStripeConnectionAction(
  _locale: string,
  _prevState: ActionResult | null,
  _formData: FormData,
): Promise<ActionResult> {
  try {
    const result = await testStripeConnection();
    if (result.apiKey === "VERIFIED" && result.webhookSecret === "CONFIGURED") {
      return { success: true, message: "Stripe API key: verified. Webhook secret: configured." };
    }
    if (result.apiKey === "NOT_CONFIGURED") {
      return { success: false, message: "Stripe API key: not configured." };
    }
    return { success: false, message: "Stripe API key: failed. Check the secret key." };
  } catch (error) {
    if (error instanceof StripeConfigError && error.code === "FORBIDDEN") {
      return { success: false, message: "You are not allowed to test the Stripe connection." };
    }
    return { success: false, message: "Could not test the Stripe connection. Try again." };
  }
}

// Validates that the server environment is configured (used by health checks).
export async function validateServerEnvironment(): Promise<boolean> {
  try {
    requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return true;
  } catch {
    return false;
  }
}

// Envio dos arquivos finais da entrega pelo admin. Valida papel no servidor,
// extensao, MIME e tamanho; sobe para o bucket privado order-results e
// registra em order_images (kind = result) para o cliente baixar via signed URL.
export async function uploadOrderResultsAction(
  locale: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = z.string().uuid().safeParse(formData.get("orderId"));
  if (!parsed.success) {
    return { success: false, message: "Invalid order." };
  }

  if (!(await isAdminUser())) {
    return { success: false, message: "Forbidden." };
  }

  const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return { success: false, message: "No files selected." };
  }

  for (const file of files) {
    const validation = validateUploadFile(file.name, file.type, file.size);
    if (!validation.ok) {
      return { success: false, message: "Invalid file: " + file.name };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data: order } = await supabase
    .from("orders")
    .select("user_id")
    .eq("id", parsed.data)
    .maybeSingle();
  if (!order) {
    return { success: false, message: "Order not found." };
  }

  for (const file of files) {
    const storagePath = buildResultPath(order.user_id, parsed.data, file.name);
    const { error: storageError } = await supabase.storage
      .from("order-results")
      .upload(storagePath, file, { contentType: file.type });
    if (storageError) {
      return { success: false, message: "Upload failed: " + file.name };
    }

    const { error: dbError } = await supabase.from("order_images").insert({
      order_id: parsed.data,
      kind: "result",
      storage_path: storagePath,
      original_filename: file.name,
    });
    if (dbError) {
      await supabase.storage.from("order-results").remove([storagePath]);
      return { success: false, message: "Could not register: " + file.name };
    }
  }

  revalidatePath("/" + safeLocale(locale) + "/dashboard/orders/" + parsed.data);
  return { success: true, message: "Results uploaded." };
}
