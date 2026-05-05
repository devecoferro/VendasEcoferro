/**
 * ML Chip Sync - Content Script
 * 
 * Roda nas páginas do ML Seller Center para:
 * 1. Detectar o seller_id do usuário logado
 * 2. Extrair chips diretamente do DOM (fallback)
 */

(function() {
  "use strict";

  // Detecta seller_id do HTML/scripts da página
  function detectSellerId() {
    // Método 1: __PRELOADED_STATE__
    const scripts = document.querySelectorAll("script");
    for (const script of scripts) {
      const text = script.textContent || "";
      
      // Procura seller_id em vários formatos
      const patterns = [
        /"seller_id"\s*:\s*(\d+)/,
        /seller_id['":\s]+(\d+)/,
        /"sellerId"\s*:\s*(\d+)/,
        /"id"\s*:\s*(\d{6,12})/,  // IDs do ML têm 6-12 dígitos
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          return match[1];
        }
      }
    }

    // Método 2: meta tags
    const metaSeller = document.querySelector('meta[name="seller-id"], meta[name="sellerId"]');
    if (metaSeller) {
      return metaSeller.getAttribute("content");
    }

    // Método 3: URL contém seller info
    const urlMatch = window.location.href.match(/seller[_-]?id[=:](\d+)/i);
    if (urlMatch) {
      return urlMatch[1];
    }

    return null;
  }

  // Extrai chips do DOM (fallback — caso o fetch do background falhe)
  function extractChipsFromDOM() {
    const chips = {};
    
    // Os chips do ML Seller Center são elementos com data-testid ou classes específicas
    const chipElements = document.querySelectorAll(
      '[class*="andes-tab__pill"], [class*="chip-count"], [data-testid*="tab"]'
    );

    for (const el of chipElements) {
      const text = el.textContent?.trim();
      const countMatch = text?.match(/(\d+)/);
      if (!countMatch) continue;

      const count = parseInt(countMatch[1], 10);
      const parent = el.closest('[data-testid], [class*="tab"]');
      const parentText = parent?.textContent?.toLowerCase() || "";

      if (parentText.includes("envios de hoje") || parentText.includes("today")) {
        chips.today = count;
      } else if (parentText.includes("próximos") || parentText.includes("next")) {
        chips.upcoming = count;
      } else if (parentText.includes("trânsito") || parentText.includes("transit")) {
        chips.in_transit = count;
      } else if (parentText.includes("finalizada") || parentText.includes("finalized")) {
        chips.finalized = count;
      }
    }

    return Object.keys(chips).length > 0 ? chips : null;
  }

  // Executa detecção
  function init() {
    const sellerId = detectSellerId();
    if (sellerId) {
      chrome.runtime.sendMessage({
        type: "seller_detected",
        seller_id: sellerId,
      });
    }

    // Também tenta extrair chips do DOM como backup
    const domChips = extractChipsFromDOM();
    if (domChips) {
      chrome.runtime.sendMessage({
        type: "dom_chips_detected",
        chips: domChips,
        seller_id: sellerId,
      });
    }
  }

  // Espera a página carregar completamente
  if (document.readyState === "complete") {
    setTimeout(init, 2000);
  } else {
    window.addEventListener("load", () => setTimeout(init, 2000));
  }
})();
