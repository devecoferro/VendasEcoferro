// Dias uteis brasileiros — sabados, domingos e feriados nacionais nao contam.
//
// O Mercado Livre NAO coleta em fim de semana nem feriado nacional.
// Confirmado empiricamente analisando o campo sla.expected_date dos
// pedidos reais — ML ja pula esses dias ao definir o SLA. Precisamos
// dessa informacao para NAO popular o bucket "Envios de hoje" nesses
// dias (operador nao pode agir, entao os pedidos ficam em "Proximos
// dias" ate o proximo dia util).

// Algoritmo de Butcher/Meeus — calcula Domingo de Pascoa no ano dado
// (retorna Date em UTC sem horario).
function calcularPascoa(ano) {
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

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

const holidaysCache = new Map();

/**
 * Retorna Set com as date keys (YYYY-MM-DD) dos feriados nacionais
 * brasileiros para o ano indicado. Cache por ano.
 *
 * Inclui: fixos (Confraternizacao, Tiradentes, Dia do Trabalho,
 * Independencia, N. Sra. Aparecida, Finados, Proclamacao, Natal) e
 * moveis derivados da Pascoa (Carnaval seg/ter, Sexta-feira Santa,
 * Corpus Christi).
 *
 * NAO inclui feriados estaduais (ex: 9 de Julho em SP) nem municipais.
 * Isso e intencional — espelha o comportamento observado do ML, que
 * so pula os nacionais.
 */
export function getBrazilianNationalHolidays(year) {
  if (holidaysCache.has(year)) return holidaysCache.get(year);
  const pascoa = calcularPascoa(year);
  const holidays = new Set([
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
 * Retorna true se a dateKey (formato YYYY-MM-DD, interpretada como
 * data calendarica no Brasil) for dia util — ou seja, NAO e sabado,
 * domingo nem feriado nacional.
 *
 * Rejeita entradas invalidas (null, undefined, formato incorreto)
 * retornando false (por seguranca — melhor nao classificar algo como
 * dia util do que o contrario).
 */
export function isBrazilianBusinessDay(dateKey) {
  if (!dateKey || typeof dateKey !== "string") return false;
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return false;
  // UTC noon — evita qualquer ambiguidade de TZ ja que a dateKey e
  // uma data calendarica pura.
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const holidays = getBrazilianNationalHolidays(y);
  return !holidays.has(dateKey);
}
