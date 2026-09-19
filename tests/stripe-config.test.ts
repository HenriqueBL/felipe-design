import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Cobertura do stripe-config (configuracao Stripe pelo Admin, Vault-backed):
// autorizacao, validacao de formato, preservacao de secret em campo vazio,
// cache/invalidacao sem restart, test connection e segredos nunca expostos.

const { adminRpc, serverAuthGetUser, serverFrom, createAdminClient } = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  serverAuthGetUser: vi.fn(),
  serverFrom: vi.fn(),
  createAdminClient: vi.fn(() => ({ rpc: adminRpc })),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseAdminClient: createAdminClient,
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: serverAuthGetUser },
    from: serverFrom,
  })),
}));

vi.mock("@/services/auth", () => ({
  isAdminUser: vi.fn(),
}));

import { isAdminUser } from "@/services/auth";
import {
  getStripeAdminStatus,
  getStripeRuntimeConfiguration,
  resetStripeRuntimeCacheForTests,
  testStripeConnection,
  updateStripeConfiguration,
  validateStripeSecretFormat,
} from "@/services/stripe-config";

const ADMIN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const FAKE_TEST_KEY = "sk_test_aaaaBBBBccccDDDDEEEE";
const FAKE_LIVE_KEY = "sk_live_aaaaBBBBccccDDDDEEEE";
const FAKE_WEBHOOK = "whsec_aaaaBBBBccccDDDDEEEE";

// Segredos claramente fake; usados para provar que NUNCA vazam em retorno.
function runtimeRow(overrides: Record<string, unknown> = {}) {
  return {
    mode: "test",
    secret_key: FAKE_TEST_KEY,
    webhook_secret: FAKE_WEBHOOK,
    ...overrides,
  };
}

function statusRow(overrides: Record<string, unknown> = {}) {
  return {
    mode: "test",
    secret_key_configured: true,
    webhook_secret_configured: true,
    secret_key_last4: "EEEE",
    configured_at: "2026-01-01T00:00:00Z",
    last_webhook_verified_at: null,
    updated_at: "2026-01-01T00:00:00Z",
    updated_by: ADMIN_ID,
    ...overrides,
  };
}

async function captureLogs(fn: () => Promise<unknown>): Promise<string> {
  const logs: string[] = [];
  const errSpy = vi.spyOn(console, "error").mockImplementation((...a) => {
    logs.push(a.map(String).join(" "));
  });
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => {
    logs.push(a.map(String).join(" "));
  });
  try {
    await fn();
  } finally {
    errSpy.mockRestore();
    logSpy.mockRestore();
  }
  return logs.join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStripeRuntimeCacheForTests();
  vi.mocked(isAdminUser).mockResolvedValue(true);
  serverAuthGetUser.mockResolvedValue({ data: { user: { id: ADMIN_ID } }, error: null });
});

afterEach(() => {
  resetStripeRuntimeCacheForTests();
});

describe("validateStripeSecretFormat", () => {
  it("modo test aceita sk_test_", () => {
    expect(validateStripeSecretFormat("test", FAKE_TEST_KEY, FAKE_WEBHOOK)).toEqual({ ok: true });
  });

  it("modo test rejeita sk_live_ (MODE_MISMATCH)", () => {
    expect(validateStripeSecretFormat("test", FAKE_LIVE_KEY, FAKE_WEBHOOK)).toEqual({
      ok: false,
      reason: "MODE_MISMATCH",
    });
  });

  it("modo live rejeita sk_test_ (MODE_MISMATCH)", () => {
    expect(validateStripeSecretFormat("live", FAKE_TEST_KEY, FAKE_WEBHOOK)).toEqual({
      ok: false,
      reason: "MODE_MISMATCH",
    });
  });

  it("webhook invalido rejeitado (INVALID_WEBHOOK)", () => {
    expect(validateStripeSecretFormat("test", FAKE_TEST_KEY, "not-a-webhook-secret")).toEqual({
      ok: false,
      reason: "INVALID_WEBHOOK",
    });
  });

  it("secret key de formato invalido rejeitado (INVALID_KEY)", () => {
    expect(validateStripeSecretFormat("test", "sk_test_", FAKE_WEBHOOK)).toEqual({
      ok: false,
      reason: "INVALID_KEY",
    });
  });
});

describe("updateStripeConfiguration", () => {
  it("nao-admin recebe FORBIDDEN e nenhuma RPC e chamada", async () => {
    vi.mocked(isAdminUser).mockResolvedValue(false);

    await expect(
      updateStripeConfiguration({ mode: "test", secretKey: FAKE_TEST_KEY, webhookSecret: FAKE_WEBHOOK }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("admin pode atualizar; envia secrets e updated_by", async () => {
    adminRpc.mockResolvedValue({ data: null, error: null });

    await updateStripeConfiguration({
      mode: "test",
      secretKey: FAKE_TEST_KEY,
      webhookSecret: FAKE_WEBHOOK,
    });

    expect(adminRpc).toHaveBeenCalledWith("update_stripe_config", {
      p_mode: "test",
      p_secret_key: FAKE_TEST_KEY,
      p_webhook_secret: FAKE_WEBHOOK,
      p_updated_by: ADMIN_ID,
    });
  });

  it("update com mode=test envia p_mode='test' (regressao: stripe_config.mode nunca NULL)", async () => {
    adminRpc.mockResolvedValue({ data: null, error: null });

    await updateStripeConfiguration({
      mode: "test",
      secretKey: FAKE_TEST_KEY,
      webhookSecret: FAKE_WEBHOOK,
    });

    expect(adminRpc.mock.calls[0]![0]).toBe("update_stripe_config");
    expect((adminRpc.mock.calls[0]![1] as Record<string, unknown>).p_mode).toBe("test");
  });

  it("update com mode=live envia p_mode='live' (regressao: mode espelha o input)", async () => {
    adminRpc.mockResolvedValue({ data: null, error: null });

    await updateStripeConfiguration({
      mode: "live",
      secretKey: FAKE_LIVE_KEY,
      webhookSecret: FAKE_WEBHOOK,
    });

    expect((adminRpc.mock.calls[0]![1] as Record<string, unknown>).p_mode).toBe("live");
  });

  it("campos vazios enviam NULL (preservar segredo existente)", async () => {
    adminRpc.mockResolvedValue({ data: null, error: null });

    await updateStripeConfiguration({ mode: "test", secretKey: "", webhookSecret: "" });

    expect(adminRpc).toHaveBeenCalledWith("update_stripe_config", {
      p_mode: "test",
      p_secret_key: null,
      p_webhook_secret: null,
      p_updated_by: ADMIN_ID,
    });
  });

  it("erro da RPC com MODE_MISMATCH e mapeado sem vazar mensagem crua", async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: "SECRET_KEY_MODE_MISMATCH detail " + FAKE_LIVE_KEY } });

    await expect(
      updateStripeConfiguration({ mode: "live", secretKey: FAKE_LIVE_KEY, webhookSecret: FAKE_WEBHOOK }),
    ).rejects.toMatchObject({ code: "MODE_MISMATCH" });
  });

  it("validacao de formato falha ANTES de qualquer chamada ao storage", async () => {
    await expect(
      updateStripeConfiguration({ mode: "test", secretKey: FAKE_LIVE_KEY, webhookSecret: FAKE_WEBHOOK }),
    ).rejects.toMatchObject({ code: "MODE_MISMATCH" });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("update invalida o cache de runtime (nova config sem restart)", async () => {
    adminRpc.mockResolvedValue({ data: [runtimeRow()], error: null });
    await getStripeRuntimeConfiguration();

    adminRpc.mockResolvedValue({ data: null, error: null });
    adminRpc.mockClear();
    await updateStripeConfiguration({ mode: "test", secretKey: "", webhookSecret: "" });

    adminRpc.mockResolvedValue({ data: [runtimeRow({ secret_key: FAKE_TEST_KEY + "new" })], error: null });
    adminRpc.mockClear();
    await getStripeRuntimeConfiguration();
    expect(adminRpc).toHaveBeenCalledWith("get_stripe_runtime_config");
  });
});

describe("getStripeRuntimeConfiguration", () => {
  it("retorna null quando nao configurado (storage vazio)", async () => {
    adminRpc.mockResolvedValue({ data: [], error: null });
    expect(await getStripeRuntimeConfiguration()).toBeNull();
  });

  it("storage com erro: STORAGE_UNAVAILABLE sem vazar detalhes", async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: "vault exploded " + FAKE_TEST_KEY } });

    await expect(getStripeRuntimeConfiguration()).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
  });

  it("cache de 10s evita nova leitura do Vault em chamadas consecutivas", async () => {
    adminRpc.mockResolvedValue({ data: [runtimeRow()], error: null });

    await getStripeRuntimeConfiguration();
    await getStripeRuntimeConfiguration();
    expect(adminRpc).toHaveBeenCalledTimes(1);
  });
});

describe("getStripeAdminStatus", () => {
  it("nao-admin recebe FORBIDDEN", async () => {
    vi.mocked(isAdminUser).mockResolvedValue(false);
    await expect(getStripeAdminStatus()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin recebe somente metadados seguros — nunca o secret completo", async () => {
    adminRpc.mockResolvedValue({ data: [statusRow()], error: null });

    const status = await getStripeAdminStatus();

    expect(JSON.stringify(status)).not.toContain(FAKE_TEST_KEY);
    expect(JSON.stringify(status)).not.toContain(FAKE_WEBHOOK);
    expect(status).toEqual({
      mode: "test",
      secretKeyConfigured: true,
      webhookSecretConfigured: true,
      secretKeyLast4: "EEEE",
      lastWebhookVerifiedAt: null,
      updatedAt: "2026-01-01T00:00:00Z",
    });
  });

  it("erro do storage: STORAGE_UNAVAILABLE sem vazar mensagem", async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: "internal " + FAKE_TEST_KEY } });

    await expect(getStripeAdminStatus()).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });
});

describe("testStripeConnection", () => {
  it("nao-admin recebe FORBIDDEN", async () => {
    vi.mocked(isAdminUser).mockResolvedValue(false);
    await expect(testStripeConnection()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("nao configurado: NOT_CONFIGURED para chave e webhook", async () => {
    adminRpc.mockResolvedValue({ data: [], error: null });

    expect(await testStripeConnection()).toEqual({
      apiKey: "NOT_CONFIGURED",
      webhookSecret: "NOT_CONFIGURED",
    });
  });

  it("chave valida com livemode coerente (HTTP 200, livemode=false em test): VERIFIED; webhook reportado apenas CONFIGURED", async () => {
    adminRpc.mockResolvedValue({ data: [runtimeRow()], error: null });
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ object: "balance", livemode: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await testStripeConnection();

    expect(result).toEqual({ apiKey: "VERIFIED", webhookSecret: "CONFIGURED" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.stripe.com/v1/balance");
    // A chave vai no header Authorization (chamada real), mas:
    const headerValue = (fetchMock.mock.calls[0]![1] as RequestInit | undefined)?.headers;
    const auth =
      typeof headerValue === "object" && headerValue !== null && "Authorization" in headerValue
        ? (headerValue as Record<string, string>).Authorization
        : undefined;
    expect(auth).toBe("Bearer " + FAKE_TEST_KEY);
    // o resultado retornado ao browser NUNCA contem o secret nem balance.
    expect(JSON.stringify(result)).not.toContain(FAKE_TEST_KEY);
    vi.unstubAllGlobals();
  });

  it("livemode divergente do mode configurado: FAILED (fail seguro)", async () => {
    adminRpc.mockResolvedValue({ data: [runtimeRow()], error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url: string, _init?: RequestInit) =>
          new Response(JSON.stringify({ object: "balance", livemode: true }), { status: 200 }),
      ),
    );

    expect(await testStripeConnection()).toEqual({
      apiKey: "FAILED",
      webhookSecret: "CONFIGURED",
    });
    vi.unstubAllGlobals();
  });

  it("chave invalida (HTTP 401): FAILED sem detalhes", async () => {
    adminRpc.mockResolvedValue({ data: [runtimeRow()], error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));

    expect(await testStripeConnection()).toEqual({
      apiKey: "FAILED",
      webhookSecret: "CONFIGURED",
    });
    vi.unstubAllGlobals();
  });

  it("falha de rede: FAILED sem vazar detalhes no retorno ou em logs", async () => {
    adminRpc.mockResolvedValue({ data: [runtimeRow()], error: null });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network error with " + FAKE_TEST_KEY);
    }));

    const logs = await captureLogs(async () => {
      const result = await testStripeConnection();
      expect(JSON.stringify(result)).not.toContain(FAKE_TEST_KEY);
    });
    expect(logs).not.toContain(FAKE_TEST_KEY);
    vi.unstubAllGlobals();
  });

  it("nao afirma webhook VERIFIED apenas por comecar com whsec_", async () => {
    adminRpc.mockResolvedValue({ data: [runtimeRow()], error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ object: "balance", livemode: false }), { status: 200 }),
      ),
    );
    const result = await testStripeConnection();
    expect(result.webhookSecret).toBe("CONFIGURED");
    expect(result.webhookSecret).not.toBe("VERIFIED");
    vi.unstubAllGlobals();
  });
});