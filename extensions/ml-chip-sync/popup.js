/**
 * ML Chip Sync - Popup Script
 */

const statusText = document.getElementById("status-text");
const sellerName = document.getElementById("seller-name");
const lastSync = document.getElementById("last-sync");
const chipToday = document.getElementById("chip-today");
const chipUpcoming = document.getElementById("chip-upcoming");
const chipTransit = document.getElementById("chip-transit");
const chipFinalized = document.getElementById("chip-finalized");
const errorMsg = document.getElementById("error-msg");
const syncBtn = document.getElementById("sync-btn");

function formatTime(isoString) {
  if (!isoString) return "-";
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  
  if (diffMs < 60000) return "Agora mesmo";
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} min atrás`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h atrás`;
  
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function updateUI(status) {
  if (!status) {
    statusText.textContent = "Aguardando primeira sync...";
    statusText.className = "status-value pending";
    return;
  }

  if (status.success) {
    statusText.textContent = "Sincronizado";
    statusText.className = "status-value success";
  } else {
    statusText.textContent = "Erro";
    statusText.className = "status-value error";
    if (status.error) {
      errorMsg.textContent = status.error;
      errorMsg.style.display = "block";
    }
  }

  if (status.seller_name) {
    sellerName.innerHTML = `<span class="seller-badge">${status.seller_name}</span>`;
  }

  lastSync.textContent = formatTime(status.last_sync);

  if (status.chips) {
    chipToday.textContent = status.chips.today ?? "-";
    chipUpcoming.textContent = status.chips.upcoming ?? "-";
    chipTransit.textContent = status.chips.in_transit ?? "-";
    chipFinalized.textContent = status.chips.finalized ?? "-";
  }
}

// Carrega status atual
chrome.runtime.sendMessage({ type: "get_status" }, (status) => {
  updateUI(status);
});

// Botão de sync manual
syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  syncBtn.textContent = "Sincronizando...";
  errorMsg.style.display = "none";

  chrome.runtime.sendMessage({ type: "force_sync" }, (status) => {
    updateUI(status);
    syncBtn.disabled = false;
    syncBtn.textContent = "Sincronizar Agora";
  });
});

// Escuta atualizações em tempo real
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "sync_complete") {
    updateUI(message.status);
  }
});
