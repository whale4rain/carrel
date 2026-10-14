/// <reference types="vite/client" />

interface Window {
  /** Exposed by the preload script. */
  carrel: { platform: string }
}
