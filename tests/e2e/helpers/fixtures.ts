/**
 * E2E Fixtures — create and cleanup test data against Supabase DEV.
 * Service role is used ONLY here; never exposed to browser contexts.
 */
import { randomBytes } from "node:crypto";
import { getAdminClient, createFreshAdminClient } from "./auth";

export interface TestPlan {
  id: string;
  angles: number;
  priceCentsUsd: number;
  priceCentsBrl: number;
}

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  role: "user" | "admin";
}

/**
 * Create or reuse an active plan with prices for E2E tests.
 * Returns the first active plan found, or creates one if none exists.
 */
export async function getOrCreateTestPlan(): Promise<TestPlan> {
  const admin = getAdminClient();

  // Try to find an existing active plan
  const { data: existingPlans } = await admin
    .from("plans")
    .select("id, angles")
    .eq("active", true)
    .limit(1);

  if (existingPlans && existingPlans.length > 0) {
    const plan = existingPlans[0];
    if (!plan) throw new Error("E2E FIXTURE: Plan query returned non-empty array but first element is undefined");
    // Get current prices
    const { data: prices } = await admin
      .from("plan_prices")
      .select("currency, amount_cents")
      .eq("plan_id", plan.id)
      .is("valid_until", null);

    const usdPrice = prices?.find((p) => p.currency === "USD");
    const brlPrice = prices?.find((p) => p.currency === "BRL");

    return {
      id: plan.id,
      angles: plan.angles,
      priceCentsUsd: usdPrice?.amount_cents ?? 2500,
      priceCentsBrl: brlPrice?.amount_cents ?? 15000,
    };
  }

  // Create a new plan if none exists
  const planId = randomBytes(16).toString("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  const { error: planError } = await admin.from("plans").insert({
    id: planId,
    angles: 1,
    active: true,
  });
  if (planError) {
    throw new Error(`E2E FIXTURE: Failed to create plan: ${planError.message}`);
  }

  // Insert USD price
  await admin.from("plan_prices").insert({
    plan_id: planId,
    currency: "USD",
    amount_cents: 2500,
    valid_from: new Date().toISOString(),
  });

  // Insert BRL price
  await admin.from("plan_prices").insert({
    plan_id: planId,
    currency: "BRL",
    amount_cents: 15000,
    valid_from: new Date().toISOString(),
  });

  return {
    id: planId,
    angles: 1,
    priceCentsUsd: 2500,
    priceCentsBrl: 15000,
  };
}

/**
 * Generate a unique email for test isolation.
 */
export function uniqueEmail(prefix: string): string {
  return `e2e-${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}@test.felipedesign.local`;
}

/**
 * Small valid JPEG fixture buffer (1x1 pixel).
 * Used for upload tests without requiring external files.
 */
export function tinyJpegBuffer(): Buffer {
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////"+
    "//////////////////////////////////////////////////"+
    "2wBDAf//////////////////////////////////////////////////////"+
    "//////////////////////////////////////////////////"+
    "wgA8EAH/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/E"+
    "ABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKwA/8QAFBABAAAA"+
    "AAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AVMA//9k=",
    "base64",
  );
}

/**
 * Cleanup all orders and related records for a given user.
 *
 * CRITICAL: Uses a FRESH service-role client (createFreshAdminClient) to avoid
 * session contamination from signInAsUser() calls on the singleton getAdminClient().
 * A contaminated client carries a user JWT instead of the service_role key,
 * causing deletes to run under RLS (which may silently fail) instead of BYPASSRLS.
 *
 * Relies on ON DELETE CASCADE defined in migration 0001_schema.sql for child tables.
 * Storage is cleaned separately (no DB cascade for storage buckets).
 *
 * Verification is STRICT: throws if any fixture data remains after cleanup.
 */
export async function cleanupUserData(userId: string): Promise<void> {
  // Always use a fresh, pure service-role client for cleanup.
  // Never reuse getAdminClient() which may have been contaminated by signInAsUser().
  const admin = createFreshAdminClient();

  // 1. List orders BEFORE deletion to know exact IDs and clean storage
  const { data: orders, error: listErr } = await admin
    .from("orders")
    .select("id")
    .eq("user_id", userId);

  if (listErr) {
    throw new Error(`E2E CLEANUP: Failed to list orders for user ${userId}: ${listErr.message}`);
  }

  const orderIds = orders?.map((o) => o.id) ?? [];

  // Diagnostic: log what we're about to clean (no PII)
  console.log(`[CLEANUP] User ${userId.slice(0, 8)}… has ${orderIds.length} order(s) to clean`);

  // 2. Clean storage objects (no DB cascade for storage)
  // Client uploads are stored as userId/orderId/filename.
  // Use known orderIds to build exact paths — avoids incomplete recursive listing issues.
  for (const orderId of orderIds) {
    const prefix = `${userId}/${orderId}`;
    const { data: files } = await admin.storage.from("client-uploads").list(prefix);
    if (files && files.length > 0) {
      const paths = files.map((f) => `${prefix}/${f.name}`);
      const { error: rmErr } = await admin.storage.from("client-uploads").remove(paths);
      if (rmErr) {
        throw new Error(`E2E CLEANUP: Failed to remove client-uploads for ${prefix}: ${rmErr.message}`);
      }
      console.log(`[CLEANUP] Removed ${paths.length} file(s) from client-uploads/${prefix}`);
    }
  }
  // Also attempt to clean any residual top-level dirs under userId that may not match known orderIds
  // (e.g., orphaned uploads from failed tests). List with limit and remove files directly.
  const { data: topLevel } = await admin.storage.from("client-uploads").list(userId, { limit: 100 });
  if (topLevel && topLevel.length > 0) {
    // Filter to only files (not dirs) at this level, since dirs should have been handled above
    const orphanFiles = topLevel.filter((item) => item.id !== null && !item.name.includes("/"));
    if (orphanFiles.length > 0) {
      const paths = orphanFiles.map((f) => `${userId}/${f.name}`);
      await admin.storage.from("client-uploads").remove(paths);
    }
  }

  // Order results: orderId/filename
  for (const orderId of orderIds) {
    const { data: resultFiles } = await admin.storage.from("order-results").list(orderId);
    if (resultFiles && resultFiles.length > 0) {
      const paths = resultFiles.map((f) => `${orderId}/${f.name}`);
      const { error: rmErr } = await admin.storage.from("order-results").remove(paths);
      if (rmErr) {
        throw new Error(`E2E CLEANUP: Failed to remove order-results for ${orderId}: ${rmErr.message}`);
      }
    }
  }

  // 3. Delete payment_events by provider_event_id BEFORE deleting payments
  //    (payment_events has no FK to orders; linked via payments.provider_event_id)
  if (orderIds.length > 0) {
    for (const orderId of orderIds) {
      const { data: payments } = await admin
        .from("payments")
        .select("provider_event_id")
        .eq("order_id", orderId);

      if (payments && payments.length > 0) {
        for (const payment of payments) {
          if (payment.provider_event_id) {
            const { error: peErr } = await admin
              .from("payment_events")
              .delete()
              .eq("provider_event_id", payment.provider_event_id);
            if (peErr) {
              throw new Error(
                `E2E CLEANUP: Failed to delete payment_event provider_event_id=${payment.provider_event_id}: ${peErr.message}`,
              );
            }
          }
        }
      }
    }
  }

  // 4. Delete orders — CASCADE handles order_images, order_revisions, payments automatically
  //    Use per-ID delete with .select("id") to PROVE deletion actually occurred
  for (const orderId of orderIds) {
    const { data: deleted, error: delErr } = await admin
      .from("orders")
      .delete()
      .eq("id", orderId)
      .select("id");

    if (delErr) {
      throw new Error(`E2E CLEANUP: Failed to delete order ${orderId}: ${delErr.message}`);
    }

    // .select("id") returns the deleted row(s). Empty array = nothing was deleted.
    if (!deleted || deleted.length === 0) {
      throw new Error(
        `E2E CLEANUP: Delete returned success but no rows affected for order ${orderId}. ` +
        `This indicates the filter did not match (wrong column, wrong client auth, or RLS block).`,
      );
    }

    console.log(`[CLEANUP] Deleted order ${orderId.slice(0, 8)}… (confirmed via .select)`);
  }

  // 5. STRICT VERIFICATION: confirm no orders remain
  const { data: remaining, error: verifyErr } = await admin
    .from("orders")
    .select("id")
    .eq("user_id", userId);

  if (verifyErr) {
    throw new Error(`E2E CLEANUP VERIFICATION: Failed to verify cleanup for user ${userId}: ${verifyErr.message}`);
  }

  if (remaining && remaining.length > 0) {
    throw new Error(
      `E2E CLEANUP VERIFICATION: ${remaining.length} order(s) still exist for user ${userId.slice(0, 8)}… after cleanup. ` +
      `IDs: ${remaining.map((r) => r.id).join(", ")}`,
    );
  }

  // 6. Verify storage is clean
  // Supabase Storage retains empty directories after file removal.
  // Only fail if actual FILES remain — empty dirs are harmless artifacts.
  const { data: remainingItems } = await admin.storage.from("client-uploads").list(userId);
  if (remainingItems && remainingItems.length > 0) {
    // Filter to real files only: items with metadata.size > 0 or containing a file extension
    // Directories returned by .list() have no size and typically no extension
    const realFiles = remainingItems.filter((item) => {
      const meta = item.metadata as { size?: number } | undefined;
      const hasSize = meta?.size !== undefined && meta.size > 0;
      const hasExtension = item.name.includes(".") && !item.name.endsWith("/");
      return hasSize || hasExtension;
    });

    if (realFiles.length > 0) {
      throw new Error(
        `E2E CLEANUP VERIFICATION: ${realFiles.length} file(s) still exist in client-uploads for user ${userId.slice(0, 8)}…: ${realFiles.map((f) => f.name).join(", ")}`,
      );
    }
    // Empty dirs exist but no real files — acceptable
    console.log(`[CLEANUP] User ${userId.slice(0, 8)}… has ${remainingItems.length} empty dir(s) in storage (no files)`);
  }

  console.log(`[CLEANUP] User ${userId.slice(0, 8)}… cleanup verified: 0 orders, 0 storage residuals`);
}

/**
 * Full user cleanup including profile and auth user.
 * Verifies user is fully removed.
 */
export async function cleanupTestUser(userId: string): Promise<void> {
  await cleanupUserData(userId);

  // Fresh client for user deletion too
  const admin = createFreshAdminClient();

  const { error: profileErr } = await admin.from("profiles").delete().eq("id", userId);
  if (profileErr) {
    throw new Error(`E2E CLEANUP: Failed to delete profile for user ${userId}: ${profileErr.message}`);
  }

  const { error: userErr } = await admin.auth.admin.deleteUser(userId);
  if (userErr) {
    throw new Error(`E2E CLEANUP: Failed to delete auth user ${userId}: ${userErr.message}`);
  }

  // VERIFY: confirm user no longer exists
  const { data: userCheck } = await admin.auth.admin.getUserById(userId);
  if (userCheck?.user) {
    throw new Error(`E2E CLEANUP VERIFICATION: Auth user ${userId} still exists after cleanup`);
  }

  console.log(`[CLEANUP] User ${userId.slice(0, 8)}… fully removed (profile + auth)`);
}