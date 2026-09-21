import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Currency, OrderRow } from "@/types/database";

export class OrderCreationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("Order creation failed: " + code);
    this.name = "OrderCreationError";
    this.code = code;
  }
}

const KNOWN_ERROR_CODES = [
  "NOT_AUTHENTICATED",
  "INVALID_QUANTITY",
  "INVALID_ITEMS",
  "PLAN_NOT_FOUND",
  "PRICE_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
] as const;

export interface CartOrderItem {
  planId: string;
  quantity: number;
}

export interface CreateCartOrderInput {
  items: CartOrderItem[];
  currency: Currency;
  affiliateCode?: string | null;
  idempotencyKey?: string | null;
}

// Multi-item: mesma autoridade server-side — o RPC valida planos, snapshot
// precos, totais e total_images atomicamente; o browser envia apenas intenção.
export async function createCartOrder(input: CreateCartOrderInput): Promise<OrderRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_cart_order", {
    p_items: input.items.map((item) => ({
      plan_id: item.planId,
      quantity: item.quantity,
    })),
    p_currency: input.currency,
    p_affiliate_code: input.affiliateCode ?? undefined,
    p_idempotency_key: input.idempotencyKey ?? undefined,
  });

  if (error) {
    const message = error.message ?? "";
    for (const code of KNOWN_ERROR_CODES) {
      if (message.includes(code)) {
        throw new OrderCreationError(code);
      }
    }
    throw new OrderCreationError("UNKNOWN");
  }

  if (!data) {
    throw new OrderCreationError("UNKNOWN");
  }

  return data;
}

export interface CreateOrderInput {
  planId: string;
  knifeQuantity: number;
  currency: Currency;
  affiliateCode?: string | null;
  idempotencyKey?: string | null;
}

// Delega toda a autoridade a RPC atomica create_order: preco vigente,
// quantidade de imagens, subtotal, backlog e prazo sao resolvidos no banco.
export async function createOrder(input: CreateOrderInput): Promise<OrderRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_order", {
    p_plan_id: input.planId,
    p_knife_quantity: input.knifeQuantity,
    p_currency: input.currency,
    p_affiliate_code: input.affiliateCode ?? undefined,
    p_idempotency_key: input.idempotencyKey ?? undefined,
  });

  if (error) {
    const message = error.message ?? "";
    for (const code of KNOWN_ERROR_CODES) {
      if (message.includes(code)) {
        throw new OrderCreationError(code);
      }
    }
    throw new OrderCreationError("UNKNOWN");
  }

  if (!data) {
    throw new OrderCreationError("UNKNOWN");
  }

  return data;
}
