/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GITHUB_TOKEN?: string;
  /* "true" lets visitors press Play. Off by default: the game is waitlist-only. */
  readonly VITE_PLAY_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
