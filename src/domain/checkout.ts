import { z } from "zod";
import type { Locale } from "@/lib/i18n/config";
import type { Currency, OrderStatus } from "@/types/database";
import { CART_MAX_ITEMS, CART_MAX_QUANTITY_PER_PLAN } from "./cart";

export const CURRENCIES: readonly Currency[] = ["BRL", "USD"];

export function defaultCurrencyForLocale(locale: Locale): Currency {
  return locale === "pt" ? "BRL" : "USD";
}

export function resolveCurrency(locale: Locale, override: string | undefined): Currency {
  if (override === "BRL" || override === "USD") {
    return override;
  }
  return defaultCurrencyForLocale(locale);
}

export const checkoutParamsSchema = z.object({
  planId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(100),
  currency: z.enum(["BRL", "USD"]),
  idempotencyKey: z.string().uuid(),
});

export type CheckoutParams = z.infer<typeof checkoutParamsSchema>;

export function parseCheckoutParams(searchParams: URLSearchParams): CheckoutParams | null {
  const parsed = checkoutParamsSchema.safeParse({
    planId: searchParams.get("plan") ?? undefined,
    quantity: searchParams.get("qty") ?? undefined,
    currency: searchParams.get("currency") ?? undefined,
    idempotencyKey: searchParams.get("key") ?? undefined,
  });
  return parsed.success ? parsed.data : null;
}

export function buildCheckoutPath(locale: Locale, params: CheckoutParams): string {
  const base = locale === "en" ? "/en/checkout" : "/pt/finalizar";
  const query = new URLSearchParams({
    plan: params.planId,
    qty: String(params.quantity),
    currency: params.currency,
    key: params.idempotencyKey,
  });
  return base + "?" + query.toString();
}

// Caminhos de retorno pos-login: apenas rotas internas /en ou /pt (anti open-redirect).
export function isSafeNextPath(path: string | null | undefined): path is string {
  if (typeof path !== "string" || path.length === 0) {
    return false;
  }
  return /^\/(en|pt)(\/|$)/.test(path) && !path.startsWith("//");
}

export const UPLOAD_ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
export const UPLOAD_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const UPLOAD_MAX_SIZE_BYTES = 10 * 1024 * 1024;

export type UploadValidationError = "extension" | "mime" | "size";

export function validateUploadFile(
  fileName: string,
  fileType: string,
  sizeBytes: number,
): { ok: boolean; error?: UploadValidationError } {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!(UPLOAD_ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, error: "extension" };
  }
  if (!(UPLOAD_ALLOWED_MIME_TYPES as readonly string[]).includes(fileType)) {
    return { ok: false, error: "mime" };
  }
  if (sizeBytes > UPLOAD_MAX_SIZE_BYTES) {
    return { ok: false, error: "size" };
  }
  return { ok: true };
}

export function sanitizeFileName(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-");
  return normalized.slice(-80) || "file";
}

export function buildUploadPath(userId: string, orderId: string, fileName: string): string {
  return userId + "/" + orderId + "/original/" + Date.now() + "-" + sanitizeFileName(fileName);
}

export function buildResultPath(userId: string, orderId: string, fileName: string): string {
  return userId + "/" + orderId + "/final/" + Date.now() + "-" + sanitizeFileName(fileName);
}

export type OrderDisplayState =
  | "awaiting_payment"
  | "awaiting_photos"
  | "in_queue"
  | "in_progress"
  | "completed"
  | "cancelled";

export function deriveOrderDisplayState(input: {
  status: OrderStatus;
  paidAt: string | null;
  sourceImageCount: number;
  totalImages: number;
}): OrderDisplayState {
  if (input.status === "cancelled") {
    return "cancelled";
  }
  if (input.status === "completed") {
    return "completed";
  }
  if (input.status === "in_progress") {
    return "in_progress";
  }
  if (input.paidAt === null) {
    return "awaiting_payment";
  }
  if (input.sourceImageCount < input.totalImages) {
    return "awaiting_photos";
  }
  return "in_queue";
}

export function canRequestRevision(
  status: OrderStatus,
  revisionCount: number,
  hasResultImages: boolean,
): boolean {
  return status === "completed" && revisionCount === 0 && hasResultImages;
}

export function isMockPaymentsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.ENABLE_MOCK_PAYMENTS === "true";
}

// Cart checkout intent: browser sends only planId + quantity per line plus
// currency and idempotency key. Prices/totals are never trusted from client.
export const cartItemIntentSchema = z.object({
  planId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(CART_MAX_QUANTITY_PER_PLAN),
});

export type CartItemIntent = z.infer<typeof cartItemIntentSchema>;

export const cartIntentSchema = z.object({
  items: z.array(cartItemIntentSchema).min(1).max(CART_MAX_ITEMS),
  currency: z.enum(["BRL", "USD"]),
  idempotencyKey: z.string().uuid(),
});

export type CartIntent = z.infer<typeof cartIntentSchema>;

export function parseCartIntent(raw: unknown): CartIntent | null {
  const parsed = cartIntentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
