import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

describe("remove_portfolio_media atomic RPC", () => {
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  let adminUserId: string;
  let workId: string;
  let mediaIds: string[] = [];

  beforeAll(async () => {
    // Create admin user via Admin API (creates auth.users + profile)
    const timestamp = Date.now();
    const email = `int-test-admin-${timestamp}@test.felipedesign.local`;
    const password = `Int-Test-Pass-${timestamp}-!Aa1`;

    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userError || !userData.user) {
      throw new Error("Failed to create admin user: " + userError?.message);
    }
    adminUserId = userData.user.id;

    // Ensure profile has admin role
    await supabase.from("profiles").upsert({
      id: adminUserId,
      email,
      role: "admin",
    });

    // Create a test work
    const { data: work, error: workErr } = await supabase
      .from("portfolio_items")
      .insert({ title: "Atomic Remove Test", published: false, sort_order: 9999 })
      .select("id")
      .single();
    if (workErr || !work) throw new Error("Failed to create work: " + workErr?.message);
    workId = work.id;

    // Create 3 media items with positions 1, 2, 3
    mediaIds = [];
    for (let i = 1; i <= 3; i++) {
      const { data: media, error: mediaErr } = await supabase
        .from("portfolio_item_media")
        .insert({
          portfolio_item_id: workId,
          storage_path: `test/atomic-remove-${i}.jpg`,
          position: i,
          width: 800,
          height: 600,
          aspect_ratio: 1.3333,
        })
        .select("id")
        .single();
      if (mediaErr || !media) throw new Error(`Failed to create media ${i}: ` + mediaErr?.message);
      mediaIds.push(media.id);
    }

    // Set hero to media[0] (position 1)
    await supabase.from("portfolio_items").update({ hero_media_id: mediaIds[0] }).eq("id", workId);
  });

  afterAll(async () => {
    // Cleanup
    if (workId) {
      await supabase.from("portfolio_item_media").delete().eq("portfolio_item_id", workId);
      await supabase.from("portfolio_items").delete().eq("id", workId);
    }
    if (adminUserId) {
      await supabase.auth.admin.deleteUser(adminUserId);
    }
  });

  it("A: remove hero media → fallback to new position 1", async () => {
    // Ensure hero is media[0] (position 1)
    await supabase.from("portfolio_items").update({ hero_media_id: mediaIds[0] }).eq("id", workId);

    const { data, error } = await supabase.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[0],
      p_admin_user_id: adminUserId,
    } as never);

    expect(error).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (Array.isArray(data) ? data[0] : data) as any;
    expect(row.removed_storage_path).toBe("test/atomic-remove-1.jpg");
    expect(row.work_id).toBe(workId);

    // New hero should be the media now at position 1 (was position 2)
    expect(row.new_hero_media_id).toBeTruthy();
    expect(row.new_hero_media_id).not.toBe(mediaIds[0]);

    // Verify remaining positions are normalized to 1, 2
    const { data: remaining } = await supabase
      .from("portfolio_item_media")
      .select("id, position")
      .eq("portfolio_item_id", workId)
      .order("position");
    expect(remaining).toHaveLength(2);
    expect(remaining?.[0]?.position).toBe(1);
    expect(remaining?.[1]?.position).toBe(2);

    // Verify hero_media_id on work matches new position 1
    const { data: work } = await supabase
      .from("portfolio_items")
      .select("hero_media_id")
      .eq("id", workId)
      .single();
    expect(work?.hero_media_id).toBe(remaining?.[0]?.id);

    // Update mediaIds for subsequent tests
    mediaIds = (remaining ?? []).map((r) => r.id);
  });

  it("B: remove non-hero media → hero unchanged, positions normalized", async () => {
    // Hero is currently mediaIds[0] (position 1)
    // Remove mediaIds[1] (position 2)
    const heroBefore = (
      await supabase.from("portfolio_items").select("hero_media_id").eq("id", workId).single()
    ).data!.hero_media_id;

    const { data, error } = await supabase.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[1],
      p_admin_user_id: adminUserId,
    } as never);

    expect(error).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (Array.isArray(data) ? data[0] : data) as any;
    expect(row.new_hero_media_id).toBe(heroBefore);

    // Verify only 1 media remains at position 1
    const { data: remaining } = await supabase
      .from("portfolio_item_media")
      .select("id, position")
      .eq("portfolio_item_id", workId)
      .order("position");
    expect(remaining).toHaveLength(1);
    expect(remaining?.[0]?.position).toBe(1);

    mediaIds = (remaining ?? []).map((r) => r.id);
  });

  it("C: remove last media → rejected, no state changed", async () => {
    const { error } = await supabase.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[0],
      p_admin_user_id: adminUserId,
    } as never);

    expect(error).toBeTruthy();
    expect(error?.message).toContain("Cannot remove the last media");

    // Verify media still exists
    const { count } = await supabase
      .from("portfolio_item_media")
      .select("id", { count: "exact", head: true })
      .eq("portfolio_item_id", workId);
    expect(count).toBe(1);
  });

  it("D: non-admin caller → rejected", async () => {
    // Create a non-admin user
    const timestamp = Date.now();
    const email = `int-test-user-${timestamp}@test.felipedesign.local`;
    const password = `Int-Test-Pass-${timestamp}-!Aa1`;

    const { data: nonAdminUser, error: naErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(naErr).toBeNull();

    const nonAdminId = nonAdminUser?.user?.id;
    expect(nonAdminId).toBeTruthy();

    await supabase.from("profiles").upsert({
      id: nonAdminId!,
      email,
      role: "customer",
    });

    const { error } = await supabase.rpc("remove_portfolio_media" as never, {
      p_media_id: mediaIds[0],
      p_admin_user_id: nonAdminId!,
    } as never);

    expect(error).toBeTruthy();
    expect(error?.message).toContain("Not authorized");

    // Cleanup
    await supabase.auth.admin.deleteUser(nonAdminId!);
  });
});