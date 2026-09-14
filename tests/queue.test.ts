import { describe, expect, it } from "vitest";
import { estimateTurnaroundAfterReady } from "@/services/queue";

const settings = {
  dailyCapacity: 4,
  cutoffTime: "17:00",
  timezone: "America/Sao_Paulo",
  now: new Date("2026-09-14T13:00:00Z"),
};

describe("estimateTurnaroundAfterReady", () => {
  it("backlog vazio com 1 imagem retorna 1 dia util apos readiness", () => {
    const result = estimateTurnaroundAfterReady({
      ...settings,
      backlogImages: 0,
      newImages: 1,
    });
    expect(result.businessDaysAfterReady).toBe(1);
    expect(result.currentBacklogImages).toBe(0);
  });

  it("backlog existente soma ao total de dias necessarios", () => {
    const result = estimateTurnaroundAfterReady({
      ...settings,
      backlogImages: 3,
      newImages: 2,
    });
    // ceil((3 + 2) / 4) = 2
    expect(result.businessDaysAfterReady).toBe(2);
    expect(result.currentBacklogImages).toBe(3);
  });

  it("varias imagens usam ceil corretamente", () => {
    const result = estimateTurnaroundAfterReady({
      ...settings,
      backlogImages: 0,
      newImages: 12,
    });
    // ceil(12 / 4) = 3
    expect(result.businessDaysAfterReady).toBe(3);
  });

  it("capacidade diaria atingida pelo backlog empurra para proximo dia", () => {
    const result = estimateTurnaroundAfterReady({
      ...settings,
      backlogImages: 4,
      newImages: 4,
    });
    // ceil((4 + 4) / 4) = 2
    expect(result.businessDaysAfterReady).toBe(2);
  });

  it("mudanca da capacidade diaria altera a estimativa", () => {
    const result = estimateTurnaroundAfterReady({
      ...settings,
      backlogImages: 0,
      newImages: 12,
      dailyCapacity: 6,
    });
    // ceil(12 / 6) = 2
    expect(result.businessDaysAfterReady).toBe(2);
  });

  it("dois pedidos quase simultaneos consideram o backlog acumulado", () => {
    const first = estimateTurnaroundAfterReady({
      ...settings,
      backlogImages: 0,
      newImages: 4,
    });
    expect(first.businessDaysAfterReady).toBe(1);

    // Simula segundo pedido vendo o primeiro ja no backlog
    const second = estimateTurnaroundAfterReady({
      ...settings,
      backlogImages: 4,
      newImages: 4,
    });
    expect(second.businessDaysAfterReady).toBe(2);
  });

  it("rejeita configuracoes invalidas", () => {
    expect(() =>
      estimateTurnaroundAfterReady({
        ...settings,
        backlogImages: 0,
        newImages: 1,
        dailyCapacity: 0,
      }),
    ).toThrow();
    expect(() =>
      estimateTurnaroundAfterReady({
        ...settings,
        backlogImages: 0,
        newImages: 1,
        cutoffTime: "25:00",
      }),
    ).toThrow();
    expect(() =>
      estimateTurnaroundAfterReady({
        ...settings,
        backlogImages: 0,
        newImages: 1,
        timezone: "Not/AZone",
      }),
    ).toThrow();
  });
});