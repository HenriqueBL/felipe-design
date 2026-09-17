import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

import {
  authorizeSourcePhotoUploadWithClient,
  finalizeSourcePhotoUploadWithClient,
  SourcePhotoError,
  SOURCE_PHOTO_BUCKET,
} from "../../src/services/source-photos";

const ALLOWED_PROJECT_REF = "jfsymthtepikfpexzxvk";

function extractProjectRef(url: string): string | null {
  const match = url.match(/https:\/\/([a-z]+)\.supabase\.co/);
  return match?.[1] ?? null;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOCK_PAYMENTS = process.env.ENABLE_MOCK_PAYMENTS;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. See tests/integration/README.md.`);
  }
  return value;
}

const validatedUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
const validatedAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON_KEY);
const validatedServiceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
requireEnv("ENABLE_MOCK_PAYMENTS", MOCK_PAYMENTS);

if (extractProjectRef(validatedUrl) !== ALLOWED_PROJECT_REF) {
  throw new Error("SAFETY: wrong project ref; aborting.");
}
if (MOCK_PAYMENTS !== "true") {
  throw new Error("SAFETY: ENABLE_MOCK_PAYMENTS must be 'true'.");
}

function createServiceClient(): SupabaseClient {
  return createClient(validatedUrl, validatedServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function createUserClient(): SupabaseClient {
  return createClient(validatedUrl, validatedAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function generatePassword(): string {
  return randomBytes(24).toString("base64url") + "Aa1!";
}

function generateEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}@test.felipedesign.local`;
}

interface FixtureUser {
  userId: string;
  email: string;
  password: string;
}

async function createFixtureUser(
  service: SupabaseClient,
  prefix: string,
): Promise<FixtureUser> {
  const email = generateEmail(prefix);
  const password = generatePassword();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data?.user) {
    throw new Error(`Failed to create fixture user: ${error?.message}`);
  }
  return { userId: data.user.id, email, password };
}

async function signInUser(email: string, password: string): Promise<SupabaseClient> {
  const client = createUserClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed: ${error.message}`);
  return client;
}

async function createFixturePlan(
  adminClient: SupabaseClient,
  angles: number,
): Promise<string> {
  const { data: plan, error: planErr } = await adminClient
    .from("plans")
    .upsert({ angles, active: true }, { onConflict: "angles" })
    .select("id")
    .single();
  if (planErr || !plan) throw new Error(`Plan upsert failed: ${planErr?.message}`);

  // set_plan_price closes any previous open price, keeping at most one open
  // row per plan+currency (no accumulation across runs on different days).
  const { error: priceErr } = await adminClient.rpc("set_plan_price", {
    p_plan_id: plan.id,
    p_currency: "BRL",
    p_amount_cents: 7500,
  });
  if (priceErr) throw new Error(`set_plan_price failed: ${priceErr.message}`);
  return plan.id;
}

// PNG assinatura basica: bytes validos de imagem pequenos.
function fakeJpeg(size: number): Uint8Array {
  const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const buf = new Uint8Array(size);
  buf.set(head);
  // pad
  for (let i = head.length; i < size; i++) buf[i] = 0x41;
  return buf;
}

/** Upload real ao Storage usando o token assinado (mesmo canal do TUS). */
async function uploadWithSignature(
  client: SupabaseClient,
  storagePath: string,
  token: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<boolean> {
  const { error } = await client.storage
    .from(SOURCE_PHOTO_BUCKET)
    .uploadToSignedUrl(storagePath, token, bytes, {
      contentType,
      upsert: false,
    });
  return !error;
}

async function storageObjectExists(
  service: SupabaseClient,
  storagePath: string,
): Promise<boolean> {
  const dir = storagePath.slice(0, storagePath.lastIndexOf("/") + 1);
  const name = storagePath.slice(storagePath.lastIndexOf("/") + 1);
  const { data } = await service.storage.from(SOURCE_PHOTO_BUCKET).list(dir, {
    search: name,
    limit: 1,
  });
  return (data ?? []).some((item) => item.name === name);
}

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(SourcePhotoError);
  expect((error as SourcePhotoError).code).toBe(code);
}

describe("Source photo upload flow (Phase A/B + cleanup)", () => {
  let service: SupabaseClient;
  let adminFixture: FixtureUser;
  let adminClient: SupabaseClient;
  const createdUserIds: string[] = [];

  // ONE SIGN-IN PER IDENTITY PER FILE: rate limit on Supabase auth.
  // Business state (orders, storage paths) stays per-test.
  const identityCache = new Map<
    string,
    { user: FixtureUser; client: SupabaseClient }
  >();
  async function getIdentity(prefix: string) {
    let cached = identityCache.get(prefix);
    if (!cached) {
      const user = await createFixtureUser(service, prefix);
      createdUserIds.push(user.userId);
      cached = { user, client: await signInUser(user.email, user.password) };
      identityCache.set(prefix, cached);
    }
    return cached;
  }

  async function setupOrder(
    _prefix: string,
    knifeQty = 1,
  ): Promise<{ user: FixtureUser; client: SupabaseClient; orderId: string }> {
    // Owner scenarios share ONE signed-in customer; isolation is per-order
    // (unique idempotency keys and storage paths), not per-user.
    const { user, client } = await getIdentity("upl-customer");
    const planId = await createFixturePlan(adminClient, 1);
    const { data: order, error } = await client.rpc("create_order", {
      p_plan_id: planId,
      p_knife_quantity: knifeQty,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    if (error || !order) throw new Error(`create_order failed: ${error?.message}`);
    return { user, client, orderId: order.id };
  }

  beforeAll(async () => {
    service = createServiceClient();
    adminFixture = await createFixtureUser(service, "upl-admin");
    createdUserIds.push(adminFixture.userId);
    await service.from("profiles").update({ role: "admin" }).eq("id", adminFixture.userId);
    adminClient = await signInUser(adminFixture.email, adminFixture.password);
  });

  afterAll(async () => {
    for (const userId of createdUserIds) {
      try {
        await service.auth.admin.deleteUser(userId);
      } catch {
        // best-effort
      }
    }
  });

  it("fluxo feliz: authorize -> upload assinado -> finalize registra a foto", async () => {
    const { user, client, orderId } = await setupOrder("happy");

    const auth = await authorizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      originalFilename: "knife.jpg",
      requestedMime: "image/jpeg",
    });
    expect(auth.storagePath.startsWith(`${user.userId}/${orderId}/knife-1/`)).toBe(true);
    expect(auth.storagePath).toMatch(/\/[0-9a-f-]{36}\.jpg$/);
    expect(auth.maxBytes).toBe(25 * 1024 * 1024);

    const uploaded = await uploadWithSignature(
      client,
      auth.storagePath,
      auth.signatureToken,
      fakeJpeg(1024),
      "image/jpeg",
    );
    expect(uploaded).toBe(true);

    const result = await finalizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      storagePath: auth.storagePath,
      originalFilename: "knife.jpg",
    });
    expect(result.alreadyRegistered).toBe(false);
    expect(result.imageId).toBeTruthy();
  });

  it("finalize idempotente: retry apos timeout nao duplica", async () => {
    const { client, orderId } = await setupOrder("idemfin");

    const auth = await authorizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      originalFilename: "idem.jpg",
      requestedMime: "image/jpeg",
    });
    await uploadWithSignature(
      client,
      auth.storagePath,
      auth.signatureToken,
      fakeJpeg(512),
      "image/jpeg",
    );

    const first = await finalizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      storagePath: auth.storagePath,
      originalFilename: "idem.jpg",
    });
    expect(first.alreadyRegistered).toBe(false);

    const second = await finalizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      storagePath: auth.storagePath,
      originalFilename: "idem.jpg",
    });
    expect(second.alreadyRegistered).toBe(true);
    expect(second.imageId).toBe(first.imageId);
  });

  it("path fora do prefixo autorizado e rejeitado", async () => {
    const { user, client, orderId } = await setupOrder("badpath");
    await expect(
      finalizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        storagePath: `${user.userId}/${crypto.randomUUID()}/knife-1/x.jpg`,
        originalFilename: "x.jpg",
      }),
    ).rejects.toSatisfy((e: unknown) => {
      expectCode(e, "INVALID_PATH");
      return true;
    });
  });

  it("objeto inexistente no Storage e rejeitado", async () => {
    const { user, client, orderId } = await setupOrder("noobj");
    await expect(
      finalizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        storagePath: `${user.userId}/${orderId}/knife-1/${crypto.randomUUID()}.jpg`,
        originalFilename: "ghost.jpg",
      }),
    ).rejects.toSatisfy((e: unknown) => {
      expectCode(e, "OBJECT_NOT_FOUND");
      return true;
    });
  });

  it("oversize: objeto > snapshot -> DB nao registra e objeto e removido", async () => {
    const { client, orderId } = await setupOrder("oversize");

    const auth = await authorizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      originalFilename: "big.jpg",
      requestedMime: "image/jpeg",
    });
    // 26 MB (snapshot = 25 MB)
    const uploaded = await uploadWithSignature(
      client,
      auth.storagePath,
      auth.signatureToken,
      fakeJpeg(26 * 1024 * 1024),
      "image/jpeg",
    );
    expect(uploaded).toBe(true);

    await expect(
      finalizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        storagePath: auth.storagePath,
        originalFilename: "big.jpg",
      }),
    ).rejects.toSatisfy((e: unknown) => {
      expectCode(e, "OBJECT_TOO_LARGE");
      return true;
    });

    // Orfao removido do bucket.
    const exists = await storageObjectExists(service, auth.storagePath);
    expect(exists).toBe(false);

    const { count } = await client
      .from("order_images")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("kind", "source");
    expect(count).toBe(0);
  });

  it("MIME invalido: objeto com content type nao permitido -> removido", async () => {
    const { client, orderId } = await setupOrder("badmime");

    const auth = await authorizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      originalFilename: "evil.jpg",
      requestedMime: "image/jpeg",
    });
    // upload com content type real de texto (validado no finalize, nao no client).
    const uploaded = await uploadWithSignature(
      client,
      auth.storagePath,
      auth.signatureToken,
      new TextEncoder().encode("not an image"),
      "text/plain",
    );
    expect(uploaded).toBe(true);

    await expect(
      finalizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        storagePath: auth.storagePath,
        originalFilename: "evil.jpg",
      }),
    ).rejects.toSatisfy((e: unknown) => {
      expectCode(e, "OBJECT_MIME_INVALID");
      return true;
    });

    const exists = await storageObjectExists(service, auth.storagePath);
    expect(exists).toBe(false);
  });

  it("intake fechado entre upload e finalize -> DB nao registra, objeto removido", async () => {
    const { client, orderId } = await setupOrder("closedfin", 1);

    // registra o minimo e faz o submit fechando o intake
    for (let i = 0; i < 3; i++) {
      const auth = await authorizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        originalFilename: `base_${i}.jpg`,
        requestedMime: "image/jpeg",
      });
      await uploadWithSignature(
        client,
        auth.storagePath,
        auth.signatureToken,
        fakeJpeg(256),
        "image/jpeg",
      );
      await finalizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        storagePath: auth.storagePath,
        originalFilename: `base_${i}.jpg`,
      });
    }
    await client.rpc("submit_source_photos", { p_order_id: orderId });

    // upload extra autorizado ANTES do submit na verdade; aqui simulamos
    // authorize anterior: usamos authorize antes do submit? Nao — intake ja
    // fechado. Entao criamos o objeto manualmente no path que seria do usuario
    // (service role) para simular upload concluido pos-fechamento via race.
    const {
      data: { user },
    } = await client.auth.getUser();
    const latePath = `${user!.id}/${orderId}/knife-1/${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await service.storage
      .from(SOURCE_PHOTO_BUCKET)
      .upload(latePath, fakeJpeg(256), { contentType: "image/jpeg", upsert: false });
    expect(upErr).toBeNull();

    await expect(
      finalizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        storagePath: latePath,
        originalFilename: "late.jpg",
      }),
    ).rejects.toSatisfy((e: unknown) => {
      expectCode(e, "INTAKE_CLOSED");
      return true;
    });

    // Objeto do finalize rejeitado e removido (nao fica orfao).
    const exists = await storageObjectExists(service, latePath);
    expect(exists).toBe(false);
  });

  it("retry apos submit: finalize do MESMO path retorna alreadyRegistered, preserva DB e Storage", async () => {
    const { client, orderId } = await setupOrder("retry-sub", 1);

    // registra o minimo (3) via fluxo real
    const paths: string[] = [];
    for (let i = 0; i < 3; i++) {
      const auth = await authorizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        originalFilename: `s${i}.jpg`,
        requestedMime: "image/jpeg",
      });
      await uploadWithSignature(
        client,
        auth.storagePath,
        auth.signatureToken,
        fakeJpeg(256),
        "image/jpeg",
      );
      await finalizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        storagePath: auth.storagePath,
        originalFilename: `s${i}.jpg`,
      });
      paths.push(auth.storagePath);
    }
    // fecha o intake
    await client.rpc("submit_source_photos", { p_order_id: orderId });

    // browser repete finalize do MESMO path (resposta anterior "perdida")
    const retry = await finalizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      storagePath: paths[0]!,
      originalFilename: "s0.jpg",
    });
    expect(retry.alreadyRegistered).toBe(true);

    // objeto continua no Storage e DB continua com exatamente 3 rows
    const exists = await storageObjectExists(service, paths[0]!);
    expect(exists).toBe(true);
    const { count } = await client
      .from("order_images")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("kind", "source");
    expect(count).toBe(3);
  });

  it("cross-user replay: cliente B tenta finalize no path do cliente A -> FORBIDDEN, nada removido", async () => {
    const { client, orderId } = await setupOrder("cross-fin", 1);

    const auth = await authorizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      originalFilename: "mine.jpg",
      requestedMime: "image/jpeg",
    });
    await uploadWithSignature(
      client,
      auth.storagePath,
      auth.signatureToken,
      fakeJpeg(256),
      "image/jpeg",
    );
    await finalizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      storagePath: auth.storagePath,
      originalFilename: "mine.jpg",
    });

    const intruder = await getIdentity("cross-fin-b");

    await expect(
      finalizeSourcePhotoUploadWithClient(intruder.client, {
        orderId,
        knifeIndex: 1,
        storagePath: auth.storagePath,
        originalFilename: "mine.jpg",
      }),
    ).rejects.toSatisfy((e: unknown) => {
      // ORDER_NOT_FOUND: a RLS de orders esconde o pedido do Cliente B
      // (nao vaga existencia); FORBIDDEN seria o caso de ordem visivel.
      // Ambos bloqueiam o acesso sem expor dados do Cliente A.
      expect(e).toBeInstanceOf(SourcePhotoError);
      const code = (e as SourcePhotoError).code;
      expect(["FORBIDDEN", "ORDER_NOT_FOUND"]).toContain(code);
      return true;
    });

    // objeto e row preservados
    const exists = await storageObjectExists(service, auth.storagePath);
    expect(exists).toBe(true);
    const { data: row } = await service
      .from("order_images")
      .select("id")
      .eq("storage_path", auth.storagePath)
      .maybeSingle();
    expect(row).not.toBeNull();
  });

  it("knife mismatch no replay: mesmo path com knife 2 -> erro estavel, sem duplicar/mover/remover", async () => {
    const { client, orderId } = await setupOrder("knife-mis", 2);

    const auth = await authorizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      originalFilename: "k1.jpg",
      requestedMime: "image/jpeg",
    });
    await uploadWithSignature(
      client,
      auth.storagePath,
      auth.signatureToken,
      fakeJpeg(256),
      "image/jpeg",
    );
    await finalizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      storagePath: auth.storagePath,
      originalFilename: "k1.jpg",
    });

    // retry declarando knife 2: prefixo nao bate -> erro estavel
    let code = "";
    await finalizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 2,
      storagePath: auth.storagePath,
      originalFilename: "k1.jpg",
    }).catch((e: unknown) => {
      expect(e).toBeInstanceOf(SourcePhotoError);
      code = (e as SourcePhotoError).code;
    });
    expect(["INVALID_PATH", "REPLAY_MISMATCH"]).toContain(code);

    // sem duplicacao: 1 row; objeto preservado; knife continua 1
    const { data: rows } = await service
      .from("order_images")
      .select("knife_index")
      .eq("storage_path", auth.storagePath);
    expect(rows).toHaveLength(1);
    expect(rows![0]!.knife_index).toBe(1);
    const exists = await storageObjectExists(service, auth.storagePath);
    expect(exists).toBe(true);
  });

  it("race no max: 4/5 registrados, dois finalizam concorrentes -> DB = 5, orfao removido", async () => {
    const { client, orderId } = await setupOrder("maxrace", 1);

    // 4 registros via fluxo real
    for (let i = 0; i < 4; i++) {
      const auth = await authorizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        originalFilename: `r${i}.jpg`,
        requestedMime: "image/jpeg",
      });
      await uploadWithSignature(
        client,
        auth.storagePath,
        auth.signatureToken,
        fakeJpeg(256),
        "image/jpeg",
      );
      await finalizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        storagePath: auth.storagePath,
        originalFilename: `r${i}.jpg`,
      });
    }

    // dois uploads extras (ambos autorizados com 4/5 e sobem ao Storage)
    const extras: string[] = [];
    for (let i = 0; i < 2; i++) {
      const auth = await authorizeSourcePhotoUploadWithClient(client, {
        orderId,
        knifeIndex: 1,
        originalFilename: `x${i}.jpg`,
        requestedMime: "image/jpeg",
      });
      const uploaded = await uploadWithSignature(
        client,
        auth.storagePath,
        auth.signatureToken,
        fakeJpeg(256),
        "image/jpeg",
      );
      expect(uploaded).toBe(true);
      extras.push(auth.storagePath);
    }

    // dois finalize concorrentes: um registra a 5a, outro falha no max.
    const results = await Promise.allSettled(
      extras.map((path) =>
        finalizeSourcePhotoUploadWithClient(client, {
          orderId,
          knifeIndex: 1,
          storagePath: path,
          originalFilename: "x.jpg",
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expectCode(
      (rejected[0] as PromiseRejectedResult).reason,
      "MAX_PHOTOS_PER_KNIFE_EXCEEDED",
    );

    const { count } = await client
      .from("order_images")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId)
      .eq("kind", "source");
    expect(count).toBe(5);

    // verificacao exata: o path registrado permanece; o rejeitado nao.
    const registeredPaths = (
      await client
        .from("order_images")
        .select("storage_path")
        .eq("order_id", orderId)
        .eq("kind", "source")
    ).data!.map((r: { storage_path: string }) => r.storage_path);
    for (const path of extras) {
      const exists = await storageObjectExists(service, path);
      expect(exists).toBe(registeredPaths.includes(path));
    }
  });
});