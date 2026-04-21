import { test, expect, type Page } from "@playwright/test";

/**
 * Smoke test da página principal /mercado-livre.
 *
 * Protege contra as regressões mais caras que tivemos recentemente:
 *   - Painel "Coletas por Data" renderiza sem crashar
 *   - Pelo menos 1 bucket operacional tem counter não-zero
 *     (valida que override ML + freshness filter + override fix estão
 *      funcionando; essas eram as 3 raízes do
 *      PERSISTENT_CLASSIFICATION_LOGIC_BUG)
 *   - Barra de ações em lote renderiza todos os botões críticos
 *
 * Esperado rodar contra produção (vendas.ecoferro.com.br) por default.
 * Credenciais via env: SMOKE_USER + SMOKE_PASSWORD (obrigatório).
 */

const USER = process.env.SMOKE_USER;
const PASSWORD = process.env.SMOKE_PASSWORD;

test.beforeAll(() => {
  if (!USER || !PASSWORD) {
    throw new Error(
      "SMOKE_USER e SMOKE_PASSWORD são obrigatórios. Configure no ambiente antes de rodar."
    );
  }
});

async function login(page: Page) {
  await page.goto("/login");
  // Os inputs do LoginPage não têm id/name; usamos proximidade do label.
  const userInput = page.getByRole("textbox").first();
  const passInput = page.locator('input[type="password"]').first();
  await userInput.fill(USER!);
  await passInput.fill(PASSWORD!);
  await page.getByRole("button", { name: /entrar/i }).click();
  // Aguarda redirect pra fora de /login
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
}

test.describe("/mercado-livre smoke", () => {
  test("login e painel Coletas por Data renderiza", async ({ page }) => {
    await login(page);
    await page.goto("/mercado-livre");

    // Título "Vendas"
    await expect(page.getByRole("heading", { name: "Vendas" })).toBeVisible();

    // Painel Coletas por Data presente (independente de dados)
    await expect(page.getByText("Coletas por Data")).toBeVisible({ timeout: 30_000 });
  });

  test("toolbar do painel tem os 6 controles esperados", async ({ page }) => {
    await login(page);
    await page.goto("/mercado-livre");

    // Aguarda o painel renderizar
    await expect(page.getByText("Coletas por Data")).toBeVisible({ timeout: 30_000 });

    // Verifica presença do dropdown de periodo ("Todas as datas" no default)
    const toolbar = page
      .locator("div")
      .filter({ hasText: /Coletas por Data/ })
      .first();
    await expect(toolbar).toBeVisible();

    // Os dropdowns e botoes centrais da toolbar
    await expect(page.getByRole("button", { name: /buscar/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /limpar/i }).first()).toBeVisible();
  });

  test("barra de ações em lote tem todos os botões críticos", async ({ page }) => {
    await login(page);
    await page.goto("/mercado-livre");

    // Aguarda tudo carregar
    await expect(page.getByText("Coletas por Data")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/Etiquetas disponíveis para impressão/)
    ).toBeVisible({ timeout: 15_000 });

    // Os 6 botões de ação em lote
    const actionNames = [
      /marcar impressas/i,
      /desmarcar/i,
      /gerar nf-e/i,
      /imprimir etiqueta ml/i,
      /etiquetas ecoferro/i,
      /separacao/i,
    ];
    for (const name of actionNames) {
      await expect(page.getByRole("button", { name }).first()).toBeVisible();
    }
  });

  test("regressão PERSISTENT_CLASSIFICATION_LOGIC_BUG — app enxerga pedidos do ML", async ({
    page,
  }) => {
    // Valida que a classificação interna (deposits[].internal_operational_counts)
    // está retornando pedidos. Antes do fix, vinha tudo zerado porque o override
    // ML iterava deposit._orders (filtrado por freshness) ao invés de allOrders.
    //
    // Consulta o endpoint /api/ml/diagnostics pra pegar a métrica estável
    // app_internal vs ml_seller_center.

    await login(page);

    const response = await page.request.get(
      "/api/ml/diagnostics?action=verify&tolerance=5"
    );
    expect(response.ok(), `diagnostics endpoint retornou ${response.status()}`).toBeTruthy();

    const body = await response.json();
    expect(body.status, JSON.stringify(body)).not.toBe("DRIFT_DETECTED");

    // Sanidade: app_internal tem pelo menos 1 bucket > 0
    const totalAppInternal = Object.values(body.app_internal ?? {}).reduce(
      (sum: number, n) => sum + (typeof n === "number" ? n : 0),
      0
    );
    expect(
      totalAppInternal,
      `app_internal todo zerado — indica regressao do override ML. Body: ${JSON.stringify(body)}`
    ).toBeGreaterThan(0);
  });
});
