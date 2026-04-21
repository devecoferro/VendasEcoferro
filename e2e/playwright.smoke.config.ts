import { defineConfig, devices } from "@playwright/test";

/**
 * Config dedicado aos smoke tests de produção.
 *
 * Rodar com:
 *   SMOKE_BASE_URL=https://vendas.ecoferro.com.br \
 *   SMOKE_USER=... SMOKE_PASSWORD=... \
 *   npm run test:smoke
 *
 * É isolado do playwright.config.ts principal (que herda do
 * lovable-agent-playwright-config e tem propósito diferente).
 */

const baseURL = process.env.SMOKE_BASE_URL || "https://vendas.ecoferro.com.br";

export default defineConfig({
  testDir: "./smoke",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    // Headless por padrão; headed quando DEBUG_SMOKE=1
    headless: !process.env.DEBUG_SMOKE,
    // Screenshots e trace em falha ajudam a diagnosticar rapido
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Timeout generoso pro scraper levar ate ~90s quando sem cache
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    // Locale pra o chromium parecer um user brasileiro
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  timeout: 120_000, // total por teste
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
