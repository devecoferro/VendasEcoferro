import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: Number(process.env.PORT || 8080),
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Aumenta o aviso de chunk para 600KB (era 500KB por padrão)
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Separa as bibliotecas pesadas em chunks próprios para que o browser
        // possa cacheá-las independentemente do código da aplicação
        manualChunks(id) {
          // Normaliza separadores de path para funcionar em Windows e Linux
          const normalizedId = id.replace(/\\/g, "/");
          // Recharts — biblioteca de gráficos, usada só no Dashboard
          // Nota: d3-* NÃO vai aqui — vai para vendor-misc para evitar referência circular
          if (normalizedId.includes("node_modules/recharts")) {
            return "vendor-recharts";
          }
          // jsPDF + QRCode — usados só em Review/Export
          if (
            normalizedId.includes("node_modules/jspdf") ||
            normalizedId.includes("node_modules/qrcode")
          ) {
            return "vendor-pdf-export";
          }
          // pdfjs-dist — usado só no upload/extração de PDF
          if (normalizedId.includes("node_modules/pdfjs-dist")) {
            return "vendor-pdfjs";
          }
          // Tesseract — usado só no OCR de imagens
          if (normalizedId.includes("node_modules/tesseract.js")) {
            return "vendor-tesseract";
          }
          // Radix UI + Shadcn components — UI estável, raramente muda
          if (normalizedId.includes("node_modules/@radix-ui")) {
            return "vendor-radix";
          }
          // React, React DOM, scheduler, react-router — todos vão para vendor-misc.
          // Separar React em chunk próprio causava dependência circular
          // (vendor-react ↔ vendor-misc) porque react-dom depende de bibliotecas
          // que por sua vez dependem de React, gerando:
          // "Cannot read properties of undefined (reading 'createContext')"
          // Outras dependências de node_modules vão para um chunk vendor geral
          if (normalizedId.includes("node_modules/")) {
            return "vendor-misc";
          }
        },
      },
    },
  },
}));
