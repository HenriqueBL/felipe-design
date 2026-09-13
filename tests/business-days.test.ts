import { describe, expect, it } from "vitest";
import {
  addBusinessDays,
  fromISODate,
  getWeekday,
  isBusinessDay,
  nextBusinessDay,
  toISODate,
} from "@/domain/business-days";

describe("business-days", () => {
  it("identifica segunda a sexta como dias uteis", () => {
    expect(isBusinessDay({ year: 2026, month: 9, day: 14 })).toBe(true);
    expect(isBusinessDay({ year: 2026, month: 9, day: 18 })).toBe(true);
  });

  it("rejeita sabado e domingo", () => {
    expect(isBusinessDay({ year: 2026, month: 9, day: 19 })).toBe(false);
    expect(isBusinessDay({ year: 2026, month: 9, day: 20 })).toBe(false);
  });

  it("rejeita dias bloqueados mesmo em dia util", () => {
    const blocked = new Set(["2026-09-14"]);
    expect(isBusinessDay({ year: 2026, month: 9, day: 14 }, blocked)).toBe(false);
  });

  it("soma dias uteis pulando o fim de semana", () => {
    expect(toISODate(addBusinessDays({ year: 2026, month: 9, day: 18 }, 3))).toBe("2026-09-23");
  });

  it("soma zero dias uteis retorna a mesma data util", () => {
    expect(toISODate(addBusinessDays({ year: 2026, month: 9, day: 15 }, 0))).toBe("2026-09-15");
  });

  it("rejeita soma com dias negativos", () => {
    expect(() => addBusinessDays({ year: 2026, month: 9, day: 15 }, -1)).toThrow();
  });

  it("avanca para o proximo dia util a partir de sexta, sabado e domingo", () => {
    expect(toISODate(nextBusinessDay({ year: 2026, month: 9, day: 18 }))).toBe("2026-09-21");
    expect(toISODate(nextBusinessDay({ year: 2026, month: 9, day: 19 }))).toBe("2026-09-21");
    expect(toISODate(nextBusinessDay({ year: 2026, month: 9, day: 20 }))).toBe("2026-09-21");
  });

  it("valida datas ISO e rejeita datas inexistentes", () => {
    expect(toISODate(fromISODate("2026-02-28"))).toBe("2026-02-28");
    expect(() => fromISODate("2026-02-30")).toThrow();
    expect(() => fromISODate("2026-13-01")).toThrow();
    expect(() => fromISODate("not-a-date")).toThrow();
  });

  it("retorna o dia da semana correto", () => {
    expect(getWeekday({ year: 2026, month: 9, day: 14 })).toBe(1);
    expect(getWeekday({ year: 2026, month: 9, day: 20 })).toBe(0);
  });
});
