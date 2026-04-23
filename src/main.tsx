import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { logError } from "./services/errorLogService";

// M5: global error handlers pra capturar crashes silenciosos.
// window.onerror pega throws sincronos e erros de loading.
// unhandledrejection pega Promise.reject sem .catch().
window.addEventListener("error", (event) => {
  void logError({
    source: "window.onerror",
    level: "error",
    message: event.message || "(sem mensagem)",
    stack: event.error?.stack || undefined,
    meta: {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    },
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  void logError({
    source: "unhandledrejection",
    level: "error",
    message:
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : JSON.stringify(reason || "(sem razão)").slice(0, 1000),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

createRoot(document.getElementById("root")!).render(<App />);
