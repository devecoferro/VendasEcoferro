import { describe, it, expect } from "vitest";

// @ts-expect-error — arquivo JS sem d.ts
import { isBrazilianBusinessDay, getBrazilianNationalHolidays } from "../../api/_lib/business-days.js";

describe("isBrazilianBusinessDay", () => {
  it("returns true for a weekday without a holiday", () => {
    // 2026-04-23 = quinta
    expect(isBrazilianBusinessDay("2026-04-23")).toBe(true);
    // 2026-04-22 = quarta
    expect(isBrazilianBusinessDay("2026-04-22")).toBe(true);
  });

  it("returns false for saturdays", () => {
    // 2026-04-25 = sábado
    expect(isBrazilianBusinessDay("2026-04-25")).toBe(false);
    // 2026-04-18 = sábado
    expect(isBrazilianBusinessDay("2026-04-18")).toBe(false);
  });

  it("returns false for sundays", () => {
    // 2026-04-26 = domingo
    expect(isBrazilianBusinessDay("2026-04-26")).toBe(false);
    // 2026-04-19 = domingo
    expect(isBrazilianBusinessDay("2026-04-19")).toBe(false);
  });

  it("returns false for fixed national holidays", () => {
    expect(isBrazilianBusinessDay("2026-01-01")).toBe(false); // Confraternização
    expect(isBrazilianBusinessDay("2026-04-21")).toBe(false); // Tiradentes
    expect(isBrazilianBusinessDay("2026-05-01")).toBe(false); // Dia do Trabalho
    expect(isBrazilianBusinessDay("2026-09-07")).toBe(false); // Independência
    expect(isBrazilianBusinessDay("2026-10-12")).toBe(false); // N.Sra. Aparecida
    expect(isBrazilianBusinessDay("2026-11-02")).toBe(false); // Finados
    expect(isBrazilianBusinessDay("2026-11-15")).toBe(false); // Proclamação
    expect(isBrazilianBusinessDay("2026-12-25")).toBe(false); // Natal
  });

  it("returns false for movable holidays derived from Easter", () => {
    // Páscoa 2026 = 05/04 (domingo)
    // Sexta Santa = 03/04/2026
    expect(isBrazilianBusinessDay("2026-04-03")).toBe(false);
    // Carnaval 2026 = 16/02 (seg) e 17/02 (ter)
    expect(isBrazilianBusinessDay("2026-02-16")).toBe(false);
    expect(isBrazilianBusinessDay("2026-02-17")).toBe(false);
    // Corpus Christi 2026 = 04/06 (quinta)
    expect(isBrazilianBusinessDay("2026-06-04")).toBe(false);
  });

  it("computes Easter-based holidays correctly for different years", () => {
    // Páscoa 2025 = 20/04 → Sexta Santa = 18/04
    expect(isBrazilianBusinessDay("2025-04-18")).toBe(false);
    // Páscoa 2027 = 28/03 → Sexta Santa = 26/03
    expect(isBrazilianBusinessDay("2027-03-26")).toBe(false);
  });

  it("returns false for invalid input", () => {
    expect(isBrazilianBusinessDay("")).toBe(false);
    expect(isBrazilianBusinessDay(null as unknown as string)).toBe(false);
    expect(isBrazilianBusinessDay(undefined as unknown as string)).toBe(false);
    expect(isBrazilianBusinessDay("not-a-date")).toBe(false);
    expect(isBrazilianBusinessDay("2026-13-01")).toBe(false);
  });
});

describe("getBrazilianNationalHolidays", () => {
  it("returns 12 national holidays for 2026", () => {
    const h = getBrazilianNationalHolidays(2026);
    expect(h.size).toBe(12);
    expect(h.has("2026-01-01")).toBe(true);
    expect(h.has("2026-12-25")).toBe(true);
  });

  it("caches by year (same Set instance on repeated calls)", () => {
    const h1 = getBrazilianNationalHolidays(2026);
    const h2 = getBrazilianNationalHolidays(2026);
    expect(h1).toBe(h2);
  });
});
