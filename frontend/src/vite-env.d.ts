/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute URL of a separately deployed backend, e.g. https://kiroku.onrender.com/api */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
