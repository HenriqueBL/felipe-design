import { describe, expect, it } from "vitest";
import { calculatePromisedDeliveryDate } from "@/services/queue";

// Segunda-feira 2026-09-14, 10:00 America/Sao_Paulo (13:00 UTC)
const MONDAY_10 = new Date("2026-09-14T13:00:00Z");
// Segunda-feira 2026-09-14, 18:00 America/Sao_Paulo (21:00 UTC)
const MONDAY_18 = new Date("2026-09-14T21:00:00Z");
// Sabado 2026-09-19, 10:00 America/Sao_Paulo (13:00 UTC)
const SATURDAY_10 = new Date("2026-09-19T13:00:00Z");

const settings = {
  dailyCapacity: 4,
  cutoffTime: "17:00",
  timezone: "America/Sao_Paulo",
};

describe("calculatePromisedDeliveryDate", () => {
  it("backlog vazio com 1 imagem entrega no mesmo dia util", () => {
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: MONDAY_10,
      backlogImages: 0,
      newImages: 1,
    });
    expect(result.startsCountingFrom).toBe("2026-09-14");
    expect(result.businessDaysNeeded).toBe(1);
    expect(result.promisedDeliveryDate).toBe("2026-09-14");
  });

  it("backlog existente empurra a entrega para o proximo dia util", () => {
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: MONDAY_10,
      backlogImages: 3,
      newImages: 2,
    });
    expect(result.businessDaysNeeded).toBe(2);
    expect(result.promisedDeliveryDate).toBe("2026-09-15");
  });

  it("varias imagens usam ceil e pulam o fim de semana", () => {
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: MONDAY_10,
      backlogImages: 0,
      newImages: 12,
    });
    expect(result.businessDaysNeeded).toBe(3);
    expect(result.promisedDeliveryDate).toBe("2026-09-16");
  });

  it("capacidade diaria atingida pelo backlog entrega no dia seguinte", () => {
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: MONDAY_10,
      backlogImages: 4,
      newImages: 4,
    });
    expect(result.businessDaysNeeded).toBe(2);
    expect(result.promisedDeliveryDate).toBe("2026-09-15");
  });

  it("pedido na sexta antes do corte entrega na propria sexta", () => {
    const fridayMorning = new Date("2026-09-18T13:00:00Z");
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: fridayMorning,
      backlogImages: 0,
      newImages: 4,
    });
    expect(result.promisedDeliveryDate).toBe("2026-09-18");
  });

  it("pedido no sabado comeca na segunda", () => {
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: SATURDAY_10,
      backlogImages: 0,
      newImages: 1,
    });
    expect(result.startsCountingFrom).toBe("2026-09-21");
    expect(result.promisedDeliveryDate).toBe("2026-09-21");
  });

  it("pedido no domingo comeca na segunda", () => {
    const sunday = new Date("2026-09-20T13:00:00Z");
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: sunday,
      backlogImages: 0,
      newImages: 1,
    });
    expect(result.startsCountingFrom).toBe("2026-09-21");
    expect(result.promisedDeliveryDate).toBe("2026-09-21");
  });

  it("pagamento antes do horario de corte conta a partir de hoje", () => {
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: MONDAY_10,
      backlogImages: 0,
      newImages: 1,
    });
    expect(result.startsCountingFrom).toBe("2026-09-14");
  });

  it("pagamento depois do horario de corte comeca no proximo dia util", () => {
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: MONDAY_18,
      backlogImages: 0,
      newImages: 1,
    });
    expect(result.startsCountingFrom).toBe("2026-09-15");
    expect(result.promisedDeliveryDate).toBe("2026-09-15");
  });

  it("mudanca posterior da capacidade diaria altera o prazo", () => {
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: MONDAY_10,
      backlogImages: 0,
      newImages: 12,
      dailyCapacity: 6,
    });
    expect(result.businessDaysNeeded).toBe(2);
    expect(result.promisedDeliveryDate).toBe("2026-09-15");
  });

  it("dois pedidos quase simultaneos consideram o backlog acumulado", () => {
    const first = calculatePromisedDeliveryDate({
      ...settings,
      now: MONDAY_10,
      backlogImages: 0,
      newImages: 4,
    });
    expect(first.promisedDeliveryDate).toBe("2026-09-14");

    const second = calculatePromisedDeliveryDate({
      ...settings,
      now: MONDAY_10,
      backlogImages: first.businessDaysNeeded * 4,
      newImages: 4,
    });
    expect(second.businessDaysNeeded).toBe(2);
    expect(second.promisedDeliveryDate).toBe("2026-09-15");
  });

  it("dias bloqueados (feriados) empurram a entrega", () => {
    const result = calculatePromisedDeliveryDate({
      ...settings,
      now: MONDAY_10,
      backlogImages: 0,
      newImages: 1,
      blockedDates: ["2026-09-14"],
    });
    expect(result.startsCountingFrom).toBe("2026-09-15");
    expect(result.promisedDeliveryDate).toBe("2026-09-15");
  });

  it("rejeita configuracoes invalidas", () => {
    expect(() =>
      calculatePromisedDeliveryDate({
        ...settings,
        now: MONDAY_10,
        backlogImages: 0,
        newImages: 1,
        dailyCapacity: 0,
      }),
    ).toThrow();
    expect(() =>
      calculatePromisedDeliveryDate({
        ...settings,
        now: MONDAY_10,
        backlogImages: 0,
        newImages: 1,
        cutoffTime: "25:00",
      }),
    ).toThrow();
    expect(() =>
      calculatePromisedDeliveryDate({
        ...settings,
        now: MONDAY_10,
        backlogImages: 0,
        newImages: 1,
        timezone: "Not/AZone",
      }),
    ).toThrow();
  });
});
