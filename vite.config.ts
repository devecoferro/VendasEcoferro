import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:3000",
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
          // Recharts — biblioteca de gráficos, usada só no Dashboard
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) {
            return "vendor-recharts";
          }
          // jsPDF + QRCode + html2canvas — usados só em Review/Export
          if (
            id.includes("node_modules/jspdf") ||
            id.includes("node_modules/html2canvas") ||
            id.includes("node_modules/qrcode") ||
            id.includes("node_modules/jsbarcode")
          ) {
            return "vendor-pdf-export";
          }
          // pdfjs-dist — usado só no upload/extração de PDF
          if (id.includes("node_modules/pdfjs-dist")) {
            return "vendor-pdfjs";
          }
          // Tesseract — usado só no OCR de imagens
          if (id.includes("node_modules/tesseract.js")) {
            return "vendor-tesseract";
          }
          // Radix UI + Shadcn components — UI estável, raramente muda
          if (id.includes("node_modules/@radix-ui")) {
            return "vendor-radix";
          }
          // React core + React DOM + React Router
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router-dom/") ||
            id.includes("node_modules/react-router/")
          ) {
            return "vendor-react";
          }
          // Outras dependências de node_modules vão para um chunk vendor geral
          if (id.includes("node_modules/")) {
            return "vendor-misc";
          }
        },
      },
    },
  },
}));
