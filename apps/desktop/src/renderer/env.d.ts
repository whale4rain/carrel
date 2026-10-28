/// <reference types="vite/client" />

interface Window {
  /** Exposed by the preload script. */
  carrel: {
    platform: string
    workspace: import('../shared/workspace-api.js').WorkspaceApi
    web: import('../shared/workspace-api.js').WebApi
    agent: import('../shared/agent-api.js').AgentApi
    memory: import('../shared/memory-api.js').MemoryApi
    menu(entries: import('../shared/menu.js').MenuEntry[]): Promise<string | undefined>
    onCommand(listener: (id: string) => void): () => void
    pathForFile(file: File): string
  }
}
