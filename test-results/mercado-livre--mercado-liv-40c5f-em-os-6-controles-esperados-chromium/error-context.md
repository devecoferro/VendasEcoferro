# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mercado-livre.spec.ts >> /mercado-livre smoke >> toolbar do painel tem os 6 controles esperados
- Location: e2e\smoke\mercado-livre.spec.ts:55:3

# Error details

```
Test timeout of 120000ms exceeded.
```

```
TimeoutError: locator.fill: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('textbox').first()

```

# Test source

```ts
  1   | import { test, expect, type Page } from "@playwright/test";
  2   | 
  3   | /**
  4   |  * Smoke test da página principal /mercado-livre.
  5   |  *
  6   |  * Protege contra as regressões mais caras que tivemos recentemente:
  7   |  *   - Painel "Coletas por Data" renderiza sem crashar
  8   |  *   - Pelo menos 1 bucket operacional tem counter não-zero
  9   |  *     (valida que override ML + freshness filter + override fix estão
  10  |  *      funcionando; essas eram as 3 raízes do
  11  |  *      PERSISTENT_CLASSIFICATION_LOGIC_BUG)
  12  |  *   - Barra de ações em lote renderiza todos os botões críticos
  13  |  *
  14  |  * Esperado rodar contra produção (vendas.ecoferro.com.br) por default.
  15  |  * Credenciais via env: SMOKE_USER + SMOKE_PASSWORD (obrigatório).
  16  |  */
  17  | 
  18  | const USER = process.env.SMOKE_USER;
  19  | const PASSWORD = process.env.SMOKE_PASSWORD;
  20  | 
  21  | test.beforeAll(() => {
  22  |   if (!USER || !PASSWORD) {
  23  |     throw new Error(
  24  |       "SMOKE_USER e SMOKE_PASSWORD são obrigatórios. Configure no ambiente antes de rodar."
  25  |     );
  26  |   }
  27  | });
  28  | 
  29  | async function login(page: Page) {
  30  |   await page.goto("/login");
  31  |   // Os inputs do LoginPage não têm id/name; usamos proximidade do label.
  32  |   const userInput = page.getByRole("textbox").first();
  33  |   const passInput = page.locator('input[type="password"]').first();
> 34  |   await userInput.fill(USER!);
      |                   ^ TimeoutError: locator.fill: Timeout 30000ms exceeded.
  35  |   await passInput.fill(PASSWORD!);
  36  |   await page.getByRole("button", { name: /entrar/i }).click();
  37  |   // Aguarda redirect pra fora de /login
  38  |   await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
  39  |     timeout: 30_000,
  40  |   });
  41  | }
  42  | 
  43  | test.describe("/mercado-livre smoke", () => {
  44  |   test("login e painel Coletas por Data renderiza", async ({ page }) => {
  45  |     await login(page);
  46  |     await page.goto("/mercado-livre");
  47  | 
  48  |     // Título "Vendas"
  49  |     await expect(page.getByRole("heading", { name: "Vendas" })).toBeVisible();
  50  | 
  51  |     // Painel Coletas por Data presente (independente de dados)
  52  |     await expect(page.getByText("Coletas por Data")).toBeVisible({ timeout: 30_000 });
  53  |   });
  54  | 
  55  |   test("toolbar do painel tem os 6 controles esperados", async ({ page }) => {
  56  |     await login(page);
  57  |     await page.goto("/mercado-livre");
  58  | 
  59  |     // Aguarda o painel renderizar
  60  |     await expect(page.getByText("Coletas por Data")).toBeVisible({ timeout: 30_000 });
  61  | 
  62  |     // Verifica presença do dropdown de periodo ("Todas as datas" no default)
  63  |     const toolbar = page
  64  |       .locator("div")
  65  |       .filter({ hasText: /Coletas por Data/ })
  66  |       .first();
  67  |     await expect(toolbar).toBeVisible();
  68  | 
  69  |     // Os dropdowns e botoes centrais da toolbar
  70  |     await expect(page.getByRole("button", { name: /buscar/i }).first()).toBeVisible();
  71  |     await expect(page.getByRole("button", { name: /limpar/i }).first()).toBeVisible();
  72  |   });
  73  | 
  74  |   test("barra de ações em lote tem todos os botões críticos", async ({ page }) => {
  75  |     await login(page);
  76  |     await page.goto("/mercado-livre");
  77  | 
  78  |     // Aguarda tudo carregar
  79  |     await expect(page.getByText("Coletas por Data")).toBeVisible({ timeout: 30_000 });
  80  |     await expect(
  81  |       page.getByText(/Etiquetas disponíveis para impressão/)
  82  |     ).toBeVisible({ timeout: 15_000 });
  83  | 
  84  |     // Os 6 botões de ação em lote
  85  |     const actionNames = [
  86  |       /marcar impressas/i,
  87  |       /desmarcar/i,
  88  |       /gerar nf-e/i,
  89  |       /imprimir etiqueta ml/i,
  90  |       /etiquetas ecoferro/i,
  91  |       /separacao/i,
  92  |     ];
  93  |     for (const name of actionNames) {
  94  |       await expect(page.getByRole("button", { name }).first()).toBeVisible();
  95  |     }
  96  |   });
  97  | 
  98  |   test("regressão PERSISTENT_CLASSIFICATION_LOGIC_BUG — app enxerga pedidos do ML", async ({
  99  |     page,
  100 |   }) => {
  101 |     // Valida que a classificação interna (deposits[].internal_operational_counts)
  102 |     // está retornando pedidos. Antes do fix, vinha tudo zerado porque o override
  103 |     // ML iterava deposit._orders (filtrado por freshness) ao invés de allOrders.
  104 |     //
  105 |     // Consulta o endpoint /api/ml/diagnostics pra pegar a métrica estável
  106 |     // app_internal vs ml_seller_center.
  107 | 
  108 |     await login(page);
  109 | 
  110 |     const response = await page.request.get(
  111 |       "/api/ml/diagnostics?action=verify&tolerance=5"
  112 |     );
  113 |     expect(response.ok(), `diagnostics endpoint retornou ${response.status()}`).toBeTruthy();
  114 | 
  115 |     const body = await response.json();
  116 |     expect(body.status, JSON.stringify(body)).not.toBe("DRIFT_DETECTED");
  117 | 
  118 |     // Sanidade: app_internal tem pelo menos 1 bucket > 0
  119 |     const totalAppInternal = Object.values(body.app_internal ?? {}).reduce(
  120 |       (sum: number, n) => sum + (typeof n === "number" ? n : 0),
  121 |       0
  122 |     );
  123 |     expect(
  124 |       totalAppInternal,
  125 |       `app_internal todo zerado — indica regressao do override ML. Body: ${JSON.stringify(body)}`
  126 |     ).toBeGreaterThan(0);
  127 |   });
  128 | });
  129 | 
```