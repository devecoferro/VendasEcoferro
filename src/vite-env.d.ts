/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ML_REDIRECT_URI?: string;
  readonly VITE_API_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
