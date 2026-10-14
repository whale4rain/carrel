/// <reference types="vite/client" />

interface Window {
  /** Exposed by the preload script. */
  carrel: {
    platform: string
    workspace: import('../shared/workspace-api.js').WorkspaceApi
    web: import('../shared/workspace-api.js').WebApi
    pathForFile(file: File): string
  }
}
