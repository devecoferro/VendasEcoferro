// Dias úteis brasileiros — versão frontend do helper que também existe
// em api/_lib/business-days.js (backend). Mantém mesma lista de feriados
// nacionais (calculados dinamicamente via algoritmo da Páscoa).
//
// Se mudar a lista de feriados aqui, ATUALIZAR TAMBÉM o backend — e
// vice-versa. Considere consolidar num único lugar (monorepo shared)
// quando houver mais lógica duplicada.

function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const holidaysCache = new Map<number, Set<string>>();

export function getBrazilianNationalHolidays(year: number): Set<string> {
  const cached = holidaysCache.get(year);
  if (cached) return cached;
  const pascoa = calcularPascoa(year);
  const holidays = new Set<string>([
    `${year}-01-01`,
    toDateKey(addDays(pascoa, -48)),
    toDateKey(addDays(pascoa, -47)),
    toDateKey(addDays(pascoa, -2)),
    `${year}-04-21`,
    `${year}-05-01`,
    toDateKey(addDays(pascoa, 60)),
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-11-15`,
    `${year}-12-25`,
  ]);
  holidaysCache.set(year, holidays);
  return holidays;
}

/**
 * Retorna true se a data for dia útil no Brasil (não sáb/dom/feriado
 * nacional). Recebe Date; compara na timezone local do browser.
 */
export function isBrazilianBusinessDay(date: Date): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const key = `${y}-${m}-${d}`;
  return !getBrazilianNationalHolidays(y).has(key);
}

/**
 * Retorna a próxima data útil a partir da data dada (inclusive se a
 * própria for útil).
 */
export function nextBusinessDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  let guard = 0;
  while (!isBrazilianBusinessDay(result) && guard < 14) {
    result.setDate(result.getDate() + 1);
    guard += 1;
  }
  return result;
}
