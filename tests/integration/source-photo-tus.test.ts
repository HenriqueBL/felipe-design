import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

import {
  authorizeSourcePhotoUploadWithClient,
  finalizeSourcePhotoUploadWithClient,
  SOURCE_PHOTO_BUCKET,
} from "../../src/services/source-photos";
import {
  signedResumableEndpointFromProjectUrl,
  uploadSourcePhotoViaTus,
} from "../../src/lib/source-photo-tus";

const ALLOWED_PROJECT_REF = "jfsymthtepikfpexzxvk";

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}. See tests/integration/README.md.`);
  return value;
}

const validatedUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
const validatedAnonKey = requireEnv(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
const validatedServiceKey = requireEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
requireEnv("ENABLE_MOCK_PAYMENTS", process.env.ENABLE_MOCK_PAYMENTS);

if (!validatedUrl.includes(ALLOWED_PROJECT_REF)) {
  throw new Error("SAFETY: wrong project ref; aborting.");
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

function fakeJpeg(size: number): Uint8Array {
  const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const buf = new Uint8Array(size);
  buf.set(head);
  for (let i = head.length; i < size; i++) buf[i] = 0x41;
  return buf;
}

describe("TUS real upload (tus-js-client contra Storage DEV)", () => {
  let service: SupabaseClient;
  let adminClient: SupabaseClient;
  const createdUserIds: string[] = [];
  const createdPaths: string[] = [];

  async function setupOrder(): Promise<{ client: SupabaseClient; orderId: string }> {
    const email = `tus-${Date.now()}-${randomBytes(4).toString("hex")}@test.felipedesign.local`;
    const password = randomBytes(24).toString("base64url") + "Aa1!";
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`user create failed: ${error?.message}`);
    createdUserIds.push(data.user.id);

    const client = createUserClient();
    const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`sign-in failed: ${signInErr.message}`);

    const { data: plan } = await adminClient
      .from("plans")
      .upsert({ angles: 1, active: true }, { onConflict: "angles" })
      .select("id")
      .single();
    // set_plan_price closes any previous open price, keeping at most one open
    // row per plan+currency (no accumulation across runs on different days).
    const { error: priceErr } = await adminClient.rpc("set_plan_price", {
      p_plan_id: plan!.id,
      p_currency: "BRL",
      p_amount_cents: 7500,
    });
    if (priceErr) throw new Error(`set_plan_price failed: ${priceErr.message}`);

    const { data: order, error: orderErr } = await client.rpc("create_order", {
      p_plan_id: plan!.id,
      p_knife_quantity: 1,
      p_currency: "BRL",
      p_idempotency_key: crypto.randomUUID(),
    });
    if (orderErr || !order) throw new Error(`create_order failed: ${orderErr?.message}`);
    return { client, orderId: order.id };
  }

  beforeAll(async () => {
    service = createServiceClient();
    const email = `tus-admin-${Date.now()}@test.felipedesign.local`;
    const password = randomBytes(24).toString("base64url") + "Aa1!";
    const { data } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (!data.user) throw new Error("admin user create failed");
    createdUserIds.push(data.user.id);
    await service.from("profiles").update({ role: "admin" }).eq("id", data.user.id);
    const admin = createUserClient();
    await admin.auth.signInWithPassword({ email, password });
    adminClient = admin;
  });

  afterAll(async () => {
    // Cleanup de objetos criados pelo teste TUS.
    if (createdPaths.length > 0) {
      await service.storage.from(SOURCE_PHOTO_BUCKET).remove(createdPaths);
    }
    for (const userId of createdUserIds) {
      try {
        await service.auth.admin.deleteUser(userId);
      } catch {
        // best-effort
      }
    }
  });

  it("authorize -> TUS upload real -> finalize -> row + objeto no Storage", async () => {
    const { client, orderId } = await setupOrder();

    // Phase A server-side (apenas metadata)
    const auth = await authorizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      originalFilename: "tus.jpg",
      requestedMime: "image/jpeg",
    });
    createdPaths.push(auth.storagePath);

    // Upload TUS REAL via tus-js-client. Em Node, tus-js-client exige
    // Buffer/Readable como source (File/Blob do browser nao sao suportados
    // fora do browser); o payload/protocolo sao identicos.
    const file = Buffer.from(fakeJpeg(700 * 1024));

    let lastProgress = -1;
    const result = await uploadSourcePhotoViaTus({
      file,
      endpoint: signedResumableEndpointFromProjectUrl(validatedUrl),
      apiKey: validatedAnonKey,
      bucket: SOURCE_PHOTO_BUCKET,
      storagePath: auth.storagePath,
      signatureToken: auth.signatureToken,
      contentType: "image/jpeg",
      onProgress: (uploaded, total) => {
        lastProgress = uploaded / total;
      },
    });
    expect(result.url).toBeTruthy();
    expect(lastProgress).toBeGreaterThanOrEqual(0);

    // Objeto existe no bucket
    const dir = auth.storagePath.slice(0, auth.storagePath.lastIndexOf("/") + 1);
    const name = auth.storagePath.slice(auth.storagePath.lastIndexOf("/") + 1);
    const { data: listed } = await service.storage
      .from(SOURCE_PHOTO_BUCKET)
      .list(dir, { search: name, limit: 1 });
    expect((listed ?? []).some((item) => item.name === name)).toBe(true);

    // Phase B server-side: valida metadata real e registra
    const finalize = await finalizeSourcePhotoUploadWithClient(client, {
      orderId,
      knifeIndex: 1,
      storagePath: auth.storagePath,
      originalFilename: "tus.jpg",
    });
    expect(finalize.alreadyRegistered).toBe(false);

    // Row criada
    const { data: row } = await service
      .from("order_images")
      .select("id, kind, knife_index")
      .eq("storage_path", auth.storagePath)
      .maybeSingle();
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("source");
    expect(row!.knife_index).toBe(1);
  });
});