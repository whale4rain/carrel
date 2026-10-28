// What the renderer sees of memory: what Keep can save, what was kept today,
// and memory's settings. Main owns the files.

/** What the Keep window can save, gathered when ⌘⇧K was pressed. */
export interface KeepOffer {
  /** The web page open in Carrel, if one is. */
  page?: { url: string; title: string }
  /** Words selected in that page. */
  selection?: string
  /** Text on the clipboard. */
  copied?: string
  /** A small picture of the screen, as a data: URL, when a screenshot could be taken. */
  screenshot?: string
}

export type KeepChoice = 'page' | 'selection' | 'copied' | 'screenshot'

/** What was kept today, for the "Kept today" line. */
export interface KeptToday {
  chats: number
  /** Pages read on the trail's sites. */
  visits: number
  /** Things kept on purpose with Keep. */
  kept: number
  /** The newest things kept on purpose, newest first. */
  latest: Array<{ kind: string; title: string }>
}

export interface MemorySettingsView {
  /** Sites whose pages are recorded as you read them. Empty: the reading trail is off. */
  trail: string[]
  /** When the day is turned into pieces (0–23). */
  eveningHour: number
}

export interface ImportResult {
  conversations: number
  /** Days of chats kept; 0 when everything was kept before. */
  kept: number
}

export interface MemoryApi {
  /** Opens the Keep window, as ⌘⇧K does. */
  openKeep(): Promise<void>
  /** The Keep window: what it can save. */
  offer(): Promise<KeepOffer>
  /** The Keep window: saves one thing, with your reason. */
  keep(choice: KeepChoice, reason: string): Promise<void>
  /** The Keep window: closes it. */
  closeKeep(): void
  today(): Promise<KeptToday>
  settings(): Promise<MemorySettingsView>
  saveSettings(settings: Partial<MemorySettingsView>): Promise<MemorySettingsView>
  /** Asks for a ChatGPT export and keeps its conversations. Null when you cancel. */
  importChatGpt(): Promise<ImportResult | null>
  /** Something was kept (by Keep, the trail or a chat): the "Kept today" line reads again. */
  onKept(listener: () => void): () => void
}

export const memoryChannels = {
  openKeep: 'memory:open-keep',
  offer: 'memory:offer',
  keep: 'memory:keep',
  closeKeep: 'memory:close-keep',
  today: 'memory:today',
  settings: 'memory:settings',
  saveSettings: 'memory:save-settings',
  importChatGpt: 'memory:import-chatgpt',
  kept: 'memory:kept',
} as const
