// ─── Versão do sistema ───────────────────────────────────────────────
// Fonte única pra versão exibida em sidebar, login, manual, etc.
// Bump manual a cada release relevante. Linked ao package.json.

export const APP_VERSION = "3.0.0";
export const APP_VERSION_LABEL = "V 3.0";

// Data de release pra mostrar em tooltips/manual
export const APP_VERSION_DATE = "2026-04-20";

// Notas do que entrou nesta versão (pra exibir no manual/about)
export const APP_VERSION_HIGHLIGHTS = [
  "Dados 1:1 com o ML Seller Center (engenharia reversa Playwright)",
  "Sub-classificação ao vivo com agrupamento por data de coleta",
  "Manual do sistema integrado (11 seções)",
  "Report Debug pra usuários enviarem bugs/sugestões/dúvidas",
  "Banner de atualização em tempo real (↻ Atualizar agora)",
];
