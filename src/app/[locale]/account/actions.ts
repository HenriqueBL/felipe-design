"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MockPaymentFlowError, simulateMockPayment } from "@/services/mock-payment-flow";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SimulatePaymentResult {
  success: boolean;
  errorCode?: string;
}

export interface RevisionResult {
  success: boolean;
  errorCode?: string;
}

const orderIdSchema = z.string().uuid();
const revisionSchema = z.object({
  orderId: z.string().uuid(),
  notes: z.string().trim().min(1).max(2000),
});

function safeLocale(locale: string): "en" | "pt" {
  return locale === "pt" ? "pt" : "en";
}

// Pagamento simulado (apenas desenvolvimento): acao recebe somente o orderId.
// Valor, moeda, prazo e transicoes de estado sao resolvidos no servidor.
export async function simulateMockPaymentAction(
  locale: string,
  _prevState: SimulatePaymentResult | null,
  formData: FormData,
): Promise<SimulatePaymentResult> {
  const parsed = orderIdSchema.safeParse(formData.get("orderId"));
  if (!parsed.success) {
    return { success: false, errorCode: "INVALID_INPUT" };
  }

  try {
    await simulateMockPayment(parsed.data);
  } catch (error) {
    const code = error instanceof MockPaymentFlowError ? error.code : "UNKNOWN";
    return { success: false, errorCode: code };
  }

  const current = safeLocale(locale);
  revalidatePath("/" + current + "/account/orders/" + parsed.data);
  revalidatePath("/" + current + "/account");
  return { success: true };
}

// Revisao gratuita: chama a RPC request_order_revision que valida dono,
// status concluido, existencia de entrega e limite de 1 revisao.
export async function requestRevisionAction(
  locale: string,
  _prevState: RevisionResult | null,
  formData: FormData,
): Promise<RevisionResult> {
  const parsed = revisionSchema.safeParse({
    orderId: formData.get("orderId"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { success: false, errorCode: "INVALID_INPUT" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("request_order_revision", {
    p_order_id: parsed.data.orderId,
    p_notes: parsed.data.notes,
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("FORBIDDEN")) {
      return { success: false, errorCode: "FORBIDDEN" };
    }
    if (message.includes("ORDER_NOT_COMPLETED")) {
      return { success: false, errorCode: "ORDER_NOT_COMPLETED" };
    }
    if (message.includes("REVISION_ALREADY_REQUESTED")) {
      return { success: false, errorCode: "REVISION_ALREADY_REQUESTED" };
    }
    return { success: false, errorCode: "UNKNOWN" };
  }

  const current = safeLocale(locale);
  revalidatePath("/" + current + "/account/orders/" + parsed.data.orderId);
  revalidatePath("/" + current + "/account");
  return { success: true };
}
