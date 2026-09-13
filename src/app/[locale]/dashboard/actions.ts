"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEnv } from "@/lib/env";
import { setOrderStatus } from "@/services/orders";
import { setPlanActive, updatePlanPrice } from "@/services/plans";
import { updateAppSettings } from "@/services/settings";

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

const settingsSchema = z.object({
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
    return { success: false, message: error instanceof Error ? error.message : "Failed." };
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
  });

  if (!parsed.success) {
    return { success: false, message: "Invalid settings values." };
  }

  try {
    await updateAppSettings({
      dailyCapacity: parsed.data.dailyCapacity,
      cutoffTime: parsed.data.cutoffTime,
      timezone: parsed.data.timezone,
    });
    revalidatePath("/" + safeLocale(locale) + "/dashboard/settings");
    return { success: true, message: "Settings updated." };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "Failed." };
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
