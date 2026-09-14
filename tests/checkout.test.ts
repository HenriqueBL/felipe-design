import { describe, expect, it } from "vitest";
import {
  buildCheckoutPath,
  buildResultPath,
  buildUploadPath,
  canRequestRevision,
  deriveOrderDisplayState,
  isSafeNextPath,
  parseCheckoutParams,
  resolveCurrency,
  sanitizeFileName,
  validateUploadFile,
} from "@/domain/checkout";

const PLAN_ID = "11111111-2222-4333-8444-555555555555";
const KEY_ID = "99999999-8888-4777-a666-555555555555";

function validParams(): URLSearchParams {
  return new URLSearchParams({
    plan: PLAN_ID,
    qty: "3",
    currency: "USD",
    key: KEY_ID,
  });
}

describe("parseCheckoutParams (intencao enviada pelo browser)", () => {
  it("aceita plano, quantidade, moeda e chave de idempotencia", () => {
    expect(parseCheckoutParams(validParams())).toEqual({
      planId: PLAN_ID,
      quantity: 3,
      currency: "USD",
      idempotencyKey: KEY_ID,
    });
  });

  it("rejeita quantidade zero", () => {
    const params = validParams();
    params.set("qty", "0");
    expect(parseCheckoutParams(params)).toBeNull();
  });

  it("rejeita quantidade negativa", () => {
    const params = validParams();
    params.set("qty", "-1");
    expect(parseCheckoutParams(params)).toBeNull();
  });

  it("rejeita quantidade excessiva", () => {
    const params = validParams();
    params.set("qty", "101");
    expect(parseCheckoutParams(params)).toBeNull();
  });

  it("rejeita moeda invalida", () => {
    const params = validParams();
    params.set("currency", "EUR");
    expect(parseCheckoutParams(params)).toBeNull();
  });

  it("rejeita plano com formato invalido", () => {
    const params = validParams();
    params.set("plan", "not-a-uuid");
    expect(parseCheckoutParams(params)).toBeNull();
  });

  it("rejeita chave de idempotencia invalida", () => {
    const params = validParams();
    params.set("key", "not-a-uuid");
    expect(parseCheckoutParams(params)).toBeNull();
  });

  it("rejeita quando falta o plano", () => {
    const params = validParams();
    params.delete("plan");
    expect(parseCheckoutParams(params)).toBeNull();
  });

  it("ignora price, total e prazo enviados pelo browser", () => {
    const params = validParams();
    params.set("price", "1");
    params.set("total", "999999");
    params.set("delivery_date", "2020-01-01");
    expect(parseCheckoutParams(params)).toEqual({
      planId: PLAN_ID,
      quantity: 3,
      currency: "USD",
      idempotencyKey: KEY_ID,
    });
  });
});

describe("isSafeNextPath (retorno pos-magic-link)", () => {
  it("aceita caminhos internos /en e /pt", () => {
    expect(isSafeNextPath("/en")).toBe(true);
    expect(isSafeNextPath("/pt")).toBe(true);
    expect(isSafeNextPath("/en/account")).toBe(true);
  });

  it("aceita o checkout com intencao preservada na querystring", () => {
    const next = "/pt/finalizar?plan=" + PLAN_ID + "&qty=2&currency=BRL&key=" + KEY_ID;
    expect(isSafeNextPath(next)).toBe(true);
  });

  it("rejeita open redirect para dominio externo", () => {
    expect(isSafeNextPath("https://evil.com")).toBe(false);
    expect(isSafeNextPath("http://evil.com/en")).toBe(false);
    expect(isSafeNextPath("//evil.com")).toBe(false);
    expect(isSafeNextPath("javascript:alert(1)")).toBe(false);
  });

  it("rejeita caminhos fora do prefixo de locale ou vazios", () => {
    expect(isSafeNextPath("/dashboard")).toBe(false);
    expect(isSafeNextPath("/ptx")).toBe(false);
    expect(isSafeNextPath("")).toBe(false);
    expect(isSafeNextPath(null)).toBe(false);
    expect(isSafeNextPath(undefined)).toBe(false);
  });
});

describe("resolveCurrency", () => {
  it("associa BRL ao PT e USD ao EN por padrao", () => {
    expect(resolveCurrency("pt", undefined)).toBe("BRL");
    expect(resolveCurrency("en", undefined)).toBe("USD");
  });

  it("respeita a troca manual de moeda", () => {
    expect(resolveCurrency("en", "BRL")).toBe("BRL");
    expect(resolveCurrency("pt", "USD")).toBe("USD");
  });

  it("cai no padrao do idioma com valor invalido", () => {
    expect(resolveCurrency("pt", "EUR")).toBe("BRL");
    expect(resolveCurrency("en", "EUR")).toBe("USD");
  });
});

describe("validateUploadFile", () => {
  it("aceita JPG, PNG e WebP dentro do limite", () => {
    expect(validateUploadFile("knife.jpg", "image/jpeg", 1024).ok).toBe(true);
    expect(validateUploadFile("knife.PNG", "image/png", 1024).ok).toBe(true);
    expect(validateUploadFile("knife.webp", "image/webp", 1024).ok).toBe(true);
  });

  it("aceita exatamente 10 MB", () => {
    expect(validateUploadFile("knife.jpg", "image/jpeg", 10 * 1024 * 1024).ok).toBe(true);
  });

  it("rejeita extensao nao permitida", () => {
    expect(validateUploadFile("knife.gif", "image/gif", 1024).error).toBe("extension");
    expect(validateUploadFile("knife.jpg.exe", "image/jpeg", 1024).error).toBe("extension");
  });

  it("rejeita MIME nao permitido", () => {
    expect(validateUploadFile("knife.jpg", "application/octet-stream", 1024).error).toBe("mime");
  });

  it("rejeita arquivo acima de 10 MB", () => {
    expect(validateUploadFile("knife.jpg", "image/jpeg", 10 * 1024 * 1024 + 1).error).toBe("size");
  });
});

describe("deriveOrderDisplayState", () => {
  it("pedido nao pago exibe aguardando pagamento", () => {
    expect(
      deriveOrderDisplayState({
        status: "pending",
        paidAt: null,
        sourceImageCount: 0,
        totalImages: 4,
      }),
    ).toBe("awaiting_payment");
  });

  it("pedido pago sem todas as fotos exibe aguardando fotos", () => {
    expect(
      deriveOrderDisplayState({
        status: "pending",
        paidAt: "2026-09-14T00:00:00Z",
        sourceImageCount: 2,
        totalImages: 6,
      }),
    ).toBe("awaiting_photos");
  });

  it("pedido pago com todas as fotos entra na fila", () => {
    expect(
      deriveOrderDisplayState({
        status: "pending",
        paidAt: "2026-09-14T00:00:00Z",
        sourceImageCount: 6,
        totalImages: 6,
      }),
    ).toBe("in_queue");
  });

  it("status internos mapeiam direto para exibicao", () => {
    expect(
      deriveOrderDisplayState({
        status: "in_progress",
        paidAt: "2026-09-14T00:00:00Z",
        sourceImageCount: 6,
        totalImages: 6,
      }),
    ).toBe("in_progress");
    expect(
      deriveOrderDisplayState({
        status: "completed",
        paidAt: "2026-09-14T00:00:00Z",
        sourceImageCount: 6,
        totalImages: 6,
      }),
    ).toBe("completed");
    expect(
      deriveOrderDisplayState({
        status: "cancelled",
        paidAt: null,
        sourceImageCount: 0,
        totalImages: 6,
      }),
    ).toBe("cancelled");
  });
});

describe("canRequestRevision (limite de revisao gratuita)", () => {
  it("permite a revisao gratuita uma vez apos a entrega", () => {
    expect(canRequestRevision("completed", 0, true)).toBe(true);
  });

  it("bloqueia a segunda revisao gratuita", () => {
    expect(canRequestRevision("completed", 1, true)).toBe(false);
  });

  it("bloqueia revisao sem entrega ou sem conclusao", () => {
    expect(canRequestRevision("completed", 0, false)).toBe(false);
    expect(canRequestRevision("in_progress", 0, true)).toBe(false);
  });
});

describe("sanitizeFileName", () => {
  it("remove caracteres perigosos do nome", () => {
    expect(sanitizeFileName("a b.jpg")).toBe("a-b.jpg");
  });

  it("elimina barras e impede path traversal", () => {
    const sanitized = sanitizeFileName("../../etc/passwd");
    expect(sanitized.includes("/")).toBe(false);
  });

  it("trunca nomes muito longos", () => {
    expect(sanitizeFileName("x".repeat(300))).toHaveLength(80);
  });
});

describe("estrutura de caminhos no storage", () => {
  it("organiza uploads do cliente sob user/order/original", () => {
    const path = buildUploadPath("user-1", "order-1", "knife.jpg");
    expect(path.startsWith("user-1/order-1/original/")).toBe(true);
    expect(path.endsWith("-knife.jpg")).toBe(true);
  });

  it("organiza entregas finais sob user/order/final", () => {
    const path = buildResultPath("user-1", "order-1", "final.jpg");
    expect(path.startsWith("user-1/order-1/final/")).toBe(true);
    expect(path.endsWith("-final.jpg")).toBe(true);
  });
});

describe("buildCheckoutPath", () => {
  it("gera o caminho publico de checkout em EN", () => {
    expect(
      buildCheckoutPath("en", {
        planId: PLAN_ID,
        quantity: 3,
        currency: "USD",
        idempotencyKey: KEY_ID,
      }),
    ).toBe("/en/checkout?plan=" + PLAN_ID + "&qty=3&currency=USD&key=" + KEY_ID);
  });

  it("gera o caminho publico de checkout em PT", () => {
    expect(
      buildCheckoutPath("pt", {
        planId: PLAN_ID,
        quantity: 3,
        currency: "BRL",
        idempotencyKey: KEY_ID,
      }),
    ).toBe("/pt/finalizar?plan=" + PLAN_ID + "&qty=3&currency=BRL&key=" + KEY_ID);
  });
});
