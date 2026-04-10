import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveAdminCredentials } from "./_lib/admin-credentials.mjs";

const baseUrl = process.env.ECOFERRO_CAPTURE_BASE_URL || "https://vendas.ecoferro.com.br";
const screenshotPath = path.join(process.cwd(), "data", "playwright", "post-deploy-panel-smoke.png");
const adminCredentials = resolveAdminCredentials();

function extractNumber(text) {
  const match = String(text || "").match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 0;
}

function normalizeSetCookieHeader(headerValue) {
  if (!headerValue) return "";
  const rawHeaders = Array.isArray(headerValue) ? headerValue : [headerValue];
  return rawHeaders
    .map((entry) => String(entry || "").split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function loginAndGetCookie() {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/app-auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "login",
        username: adminCredentials.username,
        password: adminCredentials.password,
      }),
    });

    const cookie = normalizeSetCookieHeader(
      response.headers.getSetCookie?.() || response.headers.get("set-cookie")
    );
    if (response.ok && cookie) {
      return cookie;
    }

    const payload = await response.text().catch(() => "");
    if (attempt >= 4) {
      throw new Error(`Falha no login do Ecoferro (${response.status}): ${payload}`);
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const apiEvents = [];

page.on("response", (response) => {
  const url = response.url();
  if (!url.includes("/api/ml/")) {
    return;
  }

  if (
    !url.includes("/dashboard") &&
    !url.includes("/orders") &&
    !url.includes("/private-seller-center-comparison")
  ) {
    return;
  }

  apiEvents.push({
    url,
    status: response.status(),
  });
});

page.on("console", (message) => {
  if (message.type() !== "error") {
    return;
  }

  apiEvents.push({
    type: "console",
    message: message.text(),
  });
});

page.on("pageerror", (error) => {
  apiEvents.push({
    type: "pageerror",
    message: String(error),
  });
});

try {
  const cookie = await loginAndGetCookie();
  const [cookieName, cookieValue] = cookie.split("=", 2);
  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: "vendas.ecoferro.com.br",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto(`${baseUrl}/mercado-livre`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });

  await page
    .waitForFunction(
      () => {
        const buttons = Array.from(document.querySelectorAll("button"));
        return buttons.some((button) =>
          /documentos/i.test(button.textContent || "")
        );
      },
      { timeout: 60000 }
    )
    .catch(() => {});

  const chips = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const patterns = {
      today: /Envios de hoje\s+(\d+)|(\d+)\s+Envios de hoje/i,
      upcoming: /Pr[óo]ximos dias\s+(\d+)|(\d+)\s+Pr[óo]ximos dias/i,
      inTransit: /Em tr[âa]nsito\s+(\d+)|(\d+)\s+Em tr[âa]nsito/i,
      finalized: /Finalizadas\s+(\d+)|(\d+)\s+Finalizadas/i,
    };

    function pick(pattern) {
      const match = text.match(pattern);
      if (!match) return 0;
      return Number.parseInt(match[1] || match[2] || "0", 10) || 0;
    }

    return {
      today: pick(patterns.today),
      upcoming: pick(patterns.upcoming),
      in_transit: pick(patterns.inTransit),
      finalized: pick(patterns.finalized),
    };
  });

  const gridSummaryText =
    (await page.locator("text=/\\d+\\s+vendas/i").first().textContent().catch(() => "")) || "";
  const visibleDocumentsButtons = await page.getByRole("button", { name: /documentos/i }).count();
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const diagnostics = {
    url: page.url(),
    screenshot_path: screenshotPath,
    body_excerpt: String(bodyText || "").slice(0, 1500),
    api_events: apiEvents.slice(-12),
  };
  const queueBadgeVisible = await page.getByText(/Pós-venda auditado/i).first().isVisible().catch(() => false);
  const privateAuditBlockVisible = await page
    .getByText(/Auditoria privada de pós-venda/i)
    .first()
    .isVisible()
    .catch(() => false);
  const sellerCenterAuditVisible = await page
    .getByText(/Auditoria Seller Center/i)
    .first()
    .isVisible()
    .catch(() => false);

  if (visibleDocumentsButtons < 1) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    throw new Error(
      `Nenhum botao Documentos ficou visivel no grid do painel. ${JSON.stringify(diagnostics)}`
    );
  }

  await page.getByRole("button", { name: /documentos/i }).first().click();
  await page.getByText("NF-e gerada pelo programa", { exact: true }).first().waitFor({ timeout: 15000 });

  const dialogButtons = [];
  for (const label of [
    "Gerar NF-e",
    "Reconsultar",
    "Sync com Mercado Livre",
    "Visualizar DANFE",
    "Baixar DANFE",
    "Imprimir DANFE",
    "Baixar XML",
  ]) {
    const locator = page.getByRole("button", { name: new RegExp(label, "i") }).first();
    if (await locator.isVisible().catch(() => false)) {
      dialogButtons.push(label);
    }
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        diagnostics,
        chips,
        grid_count: extractNumber(gridSummaryText),
        visible_documents_buttons: visibleDocumentsButtons,
        queue_badge_visible: queueBadgeVisible,
        private_audit_block_visible: privateAuditBlockVisible,
        seller_center_audit_visible: sellerCenterAuditVisible,
        nfe_section_visible: true,
        dialog_buttons: dialogButtons,
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
