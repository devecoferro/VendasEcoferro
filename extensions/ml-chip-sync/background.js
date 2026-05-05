/**
 * ML Chip Sync - Background Service Worker
 * 
 * Sincroniza automaticamente os chips do Mercado Livre Seller Center
 * com o VendasEcoferro a cada 5 minutos.
 * 
 * Fluxo:
 * 1. A cada 5 minutos (via chrome.alarms), busca os chips do ML
 * 2. Usa fetch same-origin para /sales-omni/packs/marketshops/operations-dashboard/tabs
 *    (aproveitando os cookies da sessão do ML no browser)
 * 3. Envia os números para o servidor VendasEcoferro via POST
 * 
 * IMPORTANTE: A extensão deve ser instalada em um browser que está logado no ML.
 * Cada perfil de browser (logado em uma conta ML diferente) precisa da extensão.
 */

const SYNC_INTERVAL_MINUTES = 5;
const ALARM_NAME = "ml-chip-sync";
const SERVER_URL = "https://vendas.ecoferro.com.br";
const ML_BASE = "https://www.mercadolivre.com.br";

// URL exata do operations-dashboard/tabs (mesma usada pelo bookmarklet que funciona)
const ML_TABS_URL = `${ML_BASE}/sales-omni/packs/marketshops/operations-dashboard/tabs?sellerSegmentType=professional&filters=TAB_TODAY&subFilters=&store=&gmt=-03:00`;

// Mapeamento de seller_id → connection_id no VendasEcoferro
const SELLER_CONNECTION_MAP = {
  "283073033": null,                                    // Ecoferro (default)
  "688498964": "3c75e4e0-6e3a-4e36-8810-3b1395f72b04", // Fantom Motoparts
};

const SELLER_NAMES = {
  "283073033": "Ecoferro",
  "688498964": "Fantom Motoparts",
};

// Credenciais do admin (usadas para autenticar no endpoint sync-from-ml)
const ADMIN_CREDENTIALS = {
  username: "admin.ecoferro",
  password: "Eco@ferro2026"
};

/**
 * Busca os chips do operations-dashboard/tabs do ML.
 * Usa UMA chamada (mesma que o bookmarklet usa com sucesso).
 * Retorna o JSON bruto da resposta.
 */
async function fetchMLTabs() {
  try {
    const response = await fetch(ML_TABS_URL, {
      credentials: "include",
      headers: {
        "Accept": "application/json",
        "x-scope": "tabs-mlb",
      },
    });

    if (!response.ok) {
      // Se 401/403, sessão expirada
      if (response.status === 401 || response.status === 403) {
        return { error: "session_expired", status: response.status };
      }
      return { error: `HTTP ${response.status}`, status: response.status };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Extrai os counts dos chips a partir da resposta do operations-dashboard/tabs.
 * 
 * Formato esperado da resposta (baseado no bookmarklet que funciona):
 * Array de objetos: [{ id: "TAB_TODAY", quantity: 88 }, { id: "TAB_NEXT_DAYS", quantity: 52 }, ...]
 * OU objeto com campo tabs: { tabs: [{ id: "TAB_TODAY", quantity: 88 }, ...] }
 */
function extractChipCounts(data) {
  if (!data) return null;

  let tabs = null;

  // Formato 1: resposta é um array direto
  if (Array.isArray(data)) {
    tabs = data;
  }
  // Formato 2: { tabs: [...] }
  else if (data.tabs && Array.isArray(data.tabs)) {
    tabs = data.tabs;
  }
  // Formato 3: { segments: [...] } (formato alternativo observado)
  else if (data.segments && Array.isArray(data.segments)) {
    tabs = data.segments;
  }
  // Formato 4: resposta é um objeto com os counts diretos
  else if (typeof data.today === "number" || typeof data.TAB_TODAY === "number") {
    return {
      today: data.today || data.TAB_TODAY || 0,
      upcoming: data.upcoming || data.TAB_NEXT_DAYS || data.next_days || 0,
      in_transit: data.in_transit || data.TAB_IN_THE_WAY || data.in_the_way || 0,
      finalized: data.finalized || data.TAB_FINALIZED || 0,
    };
  }

  if (!tabs || !Array.isArray(tabs)) {
    console.warn("[ML Chip Sync] Formato de resposta não reconhecido:", JSON.stringify(data).slice(0, 200));
    return null;
  }

  const counts = { today: 0, upcoming: 0, in_transit: 0, finalized: 0 };

  for (const tab of tabs) {
    const id = String(tab.id || tab.filter || tab.name || "").toUpperCase();
    const qty = Number(tab.quantity || tab.count || tab.total || 0);

    if (id.includes("TODAY") || id === "TAB_TODAY") {
      counts.today = qty;
    } else if (id.includes("NEXT") || id.includes("UPCOMING") || id === "TAB_NEXT_DAYS") {
      counts.upcoming = qty;
    } else if (id.includes("WAY") || id.includes("TRANSIT") || id === "TAB_IN_THE_WAY") {
      counts.in_transit = qty;
    } else if (id.includes("FINAL") || id.includes("DELIVERED") || id === "TAB_FINALIZED") {
      counts.finalized = qty;
    }
  }

  return counts;
}

/**
 * Detecta qual seller está logado no ML.
 * Tenta múltiplos métodos em sequência.
 */
async function detectSellerId() {
  // Método 1: cache local (válido por 1 hora)
  const stored = await chrome.storage.local.get(["seller_id", "seller_id_ts"]);
  if (stored.seller_id && stored.seller_id_ts) {
    const age = Date.now() - stored.seller_id_ts;
    if (age < 3600000) {
      return stored.seller_id;
    }
  }

  // Método 2: buscar página de vendas e extrair seller_id do HTML
  try {
    const response = await fetch(`${ML_BASE}/vendas/omni/lista`, {
      credentials: "include",
      headers: { "Accept": "text/html" },
      redirect: "follow",
    });

    if (response.ok) {
      const html = await response.text();
      
      // Procura seller_id em vários padrões no HTML
      const patterns = [
        /"seller_id"\s*:\s*(\d+)/,
        /sellerId['":\s]+(\d+)/,
        /"id"\s*:\s*(\d{6,12})/,
        /seller[_.]id=(\d+)/,
        /"cust_id"\s*:\s*"?(\d+)/,
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          const sellerId = match[1];
          // Validar que é um seller_id conhecido
          if (SELLER_NAMES[sellerId]) {
            await chrome.storage.local.set({ seller_id: sellerId, seller_id_ts: Date.now() });
            return sellerId;
          }
        }
      }

      // Se não encontrou um seller conhecido, pega o primeiro match numérico razoável
      const genericMatch = html.match(/"seller_id"\s*:\s*(\d{6,12})/);
      if (genericMatch) {
        const sellerId = genericMatch[1];
        await chrome.storage.local.set({ seller_id: sellerId, seller_id_ts: Date.now() });
        return sellerId;
      }
    }
  } catch {
    // fallback
  }

  // Método 3: cookies
  try {
    const cookies = await chrome.cookies.getAll({ domain: ".mercadolivre.com.br" });
    for (const cookie of cookies) {
      if (cookie.name === "seller_id" || cookie.name === "cust_id") {
        const sellerId = cookie.value;
        await chrome.storage.local.set({ seller_id: sellerId, seller_id_ts: Date.now() });
        return sellerId;
      }
    }
  } catch {
    // sem permissão
  }

  return stored.seller_id || null;
}

/**
 * Envia os chips para o servidor VendasEcoferro.
 */
async function sendChipsToServer(chips, sellerId) {
  const connectionId = SELLER_CONNECTION_MAP[sellerId] || null;

  const payload = {
    username: ADMIN_CREDENTIALS.username,
    password: ADMIN_CREDENTIALS.password,
    seller_id: sellerId,
    connection_id: connectionId,
    counts: {
      today: chips.today,
      upcoming: chips.upcoming,
      in_transit: chips.in_transit,
      finalized: chips.finalized,
    },
    source: "chrome_extension_v1",
    timestamp: new Date().toISOString(),
  };

  const response = await fetch(`${SERVER_URL}/api/ml/admin/sync-from-ml`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  return await response.json();
}

/**
 * Executa o ciclo completo de sincronização.
 */
async function syncChips() {
  const startTime = Date.now();
  
  try {
    // 1. Buscar tabs do ML
    const tabsResult = await fetchMLTabs();
    
    if (tabsResult.error) {
      const status = {
        last_attempt: new Date().toISOString(),
        success: false,
        error: tabsResult.error === "session_expired"
          ? "Sessão ML expirada. Faça login no Mercado Livre neste browser."
          : `Erro ao buscar dados: ${tabsResult.error}`,
      };
      await chrome.storage.local.set({ sync_status: status });
      updateBadge(false);
      return status;
    }

    // 2. Extrair contagens
    const chips = extractChipCounts(tabsResult.data);
    
    if (!chips) {
      const status = {
        last_attempt: new Date().toISOString(),
        success: false,
        error: "Formato de resposta do ML não reconhecido",
        raw_response: JSON.stringify(tabsResult.data).slice(0, 500),
      };
      await chrome.storage.local.set({ sync_status: status });
      updateBadge(false);
      return status;
    }

    // 3. Detectar seller
    const sellerId = await detectSellerId();

    // 4. Enviar para o servidor
    const serverResult = await sendChipsToServer(chips, sellerId);

    // 5. Salvar status de sucesso
    const status = {
      last_sync: new Date().toISOString(),
      last_attempt: new Date().toISOString(),
      success: true,
      chips,
      seller_id: sellerId,
      seller_name: SELLER_NAMES[sellerId] || "Conta ML",
      connection_id: serverResult.connection_id,
      duration_ms: Date.now() - startTime,
      expires_in_seconds: serverResult.expires_in_seconds,
    };
    await chrome.storage.local.set({ sync_status: status });
    updateBadge(true);

    // Notificar popup se aberto
    try {
      chrome.runtime.sendMessage({ type: "sync_complete", status });
    } catch {
      // popup não está aberto
    }

    return status;
  } catch (err) {
    const status = {
      last_attempt: new Date().toISOString(),
      success: false,
      error: err.message,
    };
    await chrome.storage.local.set({ sync_status: status });
    updateBadge(false);
    return status;
  }
}

/**
 * Atualiza o badge da extensão para indicar status.
 */
function updateBadge(success) {
  if (success) {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#28a745" });
  } else {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#dc3545" });
  }
}

// ═══════════════════════════════════════════════════════════════
// ALARM SETUP — Sincronização periódica a cada 5 minutos
// ═══════════════════════════════════════════════════════════════

chrome.alarms.create(ALARM_NAME, {
  delayInMinutes: 0.1, // Primeira execução em ~6 segundos
  periodInMinutes: SYNC_INTERVAL_MINUTES,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    syncChips();
  }
});

// ═══════════════════════════════════════════════════════════════
// MESSAGE HANDLERS (comunicação com popup e content scripts)
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "force_sync") {
    syncChips().then(sendResponse);
    return true; // resposta assíncrona
  }

  if (message.type === "get_status") {
    chrome.storage.local.get(["sync_status"], (result) => {
      sendResponse(result.sync_status || null);
    });
    return true;
  }

  if (message.type === "seller_detected") {
    // Content script detectou o seller_id na página
    if (message.seller_id) {
      chrome.storage.local.set({
        seller_id: String(message.seller_id),
        seller_id_ts: Date.now(),
      });
    }
    sendResponse({ ok: true });
    return false;
  }
});

// ═══════════════════════════════════════════════════════════════
// LIFECYCLE HOOKS
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("[ML Chip Sync] Extensão instalada! Primeira sincronização em 6 segundos...");
    // Badge inicial
    chrome.action.setBadgeText({ text: "..." });
    chrome.action.setBadgeBackgroundColor({ color: "#6c757d" });
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[ML Chip Sync] Browser iniciado. Sincronizando em 5s...");
  // Sync ao iniciar o browser (o alarm pode demorar)
  setTimeout(() => syncChips(), 5000);
});
