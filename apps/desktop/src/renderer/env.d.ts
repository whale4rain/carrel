/// <reference types="vite/client" />

interface Window {
  /** Exposed by the preload script. */
  carrel: {
    platform: string
    workspace: import('../shared/workspace-api.js').WorkspaceApi
    web: import('../shared/workspace-api.js').WebApi
    agent: import('../shared/agent-api.js').AgentApi
    menu(entries: import('../shared/menu.js').MenuEntry[]): Promise<string | undefined>
    pathForFile(file: File): string
  }
}
