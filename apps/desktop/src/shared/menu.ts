// Right-click menus: native on Mac and Windows, so they look and behave like
// the system's, with each command's shortcut shown beside it.

/** One line in a right-click menu. */
export type MenuEntry =
  /** A command; `accelerator` is the shortcut shown beside it, in Electron's form ("CommandOrControl+."). */
  | { id: string; label: string; accelerator?: string; enabled?: boolean }
  /** The system's own text commands. */
  | { role: 'cut' | 'copy' | 'paste' | 'selectAll' }
  | { separator: true }

const ROLES = new Set(['cut', 'copy', 'paste', 'selectAll'])

export function isMenuEntries(value: unknown): value is MenuEntry[] {
  return (
    Array.isArray(value) &&
    value.length <= 40 &&
    value.every((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return false
      const line = entry as Record<string, unknown>
      if (line.separator === true) return true
      if (typeof line.role === 'string') return ROLES.has(line.role)
      return (
        typeof line.id === 'string' &&
        typeof line.label === 'string' &&
        (line.accelerator === undefined || typeof line.accelerator === 'string') &&
        (line.enabled === undefined || typeof line.enabled === 'boolean')
      )
    })
  )
}

/** What a right-click on selected words offers, in pages and on the desk alike. */
export const TEXT_COMMANDS: readonly MenuEntry[] = [
  { id: 'that', label: 'that.', accelerator: 'CommandOrControl+.' },
  { id: 'ask', label: 'Ask the agent about this…' },
  { id: 'explain', label: 'Explain this' },
]

/**
 * What to ask the agent about something right-clicked: a question of your own
 * about it, an explanation, or a rewrite of words in a note.
 */
export type AgentAsk = { kind: 'ask'; quote?: string; note?: string } | { kind: 'explain' } | { kind: 'rewrite'; quote: string; note: string }
