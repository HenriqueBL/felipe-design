"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/services/auth";
import { createOrder, OrderCreationError } from "@/services/order-creation";
import { accountOrderPath, checkoutPath, loginPath } from "@/lib/paths";

export interface CreateOrderResult {
  success: boolean;
  errorCode?: string;
}

// O browser envia apenas a intencao: plano, quantidade, moeda e chave de
// idempotencia. Preco, imagens, subtotal, total e prazo sao resolvidos
// exclusivamente pela RPC create_order no servidor.
const intentSchema = z.object({
  planId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(100),
  currency: z.enum(["BRL", "USD"]),
  idempotencyKey: z.string().uuid(),
});

function safeLocale(locale: string): "en" | "pt" {
  return locale === "pt" ? "pt" : "en";
}

function checkoutReturnUrl(
  locale: "en" | "pt",
  planId: string,
  quantity: number,
  currency: "BRL" | "USD",
  idempotencyKey: string,
): string {
  return (
    checkoutPath(locale) +
    "?" +
    new URLSearchParams({
      plan: planId,
      qty: String(quantity),
      currency: currency,
      key: idempotencyKey,
    }).toString()
  );
}

export async function createOrderAction(
  locale: string,
  _prevState: CreateOrderResult | null,
  formData: FormData,
): Promise<CreateOrderResult> {
  const parsed = intentSchema.safeParse({
    planId: formData.get("planId"),
    quantity: formData.get("quantity"),
    currency: formData.get("currency"),
    idempotencyKey: formData.get("idempotencyKey"),
  });

  if (!parsed.success) {
    return { success: false, errorCode: "INVALID_INPUT" };
  }

  const current = safeLocale(locale);
  const user = await getCurrentUser();

  if (!user) {
    const nextUrl = checkoutReturnUrl(
      current,
      parsed.data.planId,
      parsed.data.quantity,
      parsed.data.currency,
      parsed.data.idempotencyKey,
    );
    redirect(loginPath(current, nextUrl));
  }

  let createdOrderId: string | null = null;
  let errorCode: string | undefined;

  try {
    const order = await createOrder({
      planId: parsed.data.planId,
      knifeQuantity: parsed.data.quantity,
      currency: parsed.data.currency,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    createdOrderId = order.id;
  } catch (error) {
    errorCode = error instanceof OrderCreationError ? error.code : "UNKNOWN";
  }

  if (createdOrderId !== null) {
    revalidatePath("/" + current + "/account");
    redirect(accountOrderPath(current, createdOrderId));
  }

  return { success: false, errorCode: errorCode ?? "UNKNOWN" };
}
