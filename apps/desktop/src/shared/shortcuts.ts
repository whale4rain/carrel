// Every keyboard shortcut in one table, so the shortcut sheet, tooltips, the
// right-click menus and the Mac menu bar all say the same thing, the way each
// system writes it: ⌘⇧Z on a Mac, Ctrl+Shift+Z on Windows.
import type { Frame } from './frame.js'

/** Keys pressed together. `mod` is ⌘ on a Mac and Ctrl elsewhere. */
export interface Keys {
  mod?: boolean
  shift?: boolean
  alt?: boolean
  /** As `KeyboardEvent.key` has it for the unshifted key ('k', '.', 'Enter', 'Escape'), or 'Drag' for a mouse drag. */
  key: string
}

/** The same keys everywhere, or a Mac's own and everyone else's. */
export type Binding = Keys | { mac: Keys; other: Keys }

export interface Shortcut {
  id: string
  label: string
  keys: Binding
}

export interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    title: 'Anywhere',
    shortcuts: [
      { id: 'search', label: 'Search everything', keys: { mod: true, key: 'k' } },
      { id: 'open-note', label: 'Open a note by name', keys: { mod: true, key: 'o' } },
      { id: 'daily', label: 'Today’s note', keys: { mod: true, shift: true, key: 'd' } },
      { id: 'keep', label: 'Keep the page, a selection or a screenshot (from any app)', keys: { mod: true, shift: true, key: 'k' } },
      { id: 'agent', label: 'Open or close the agent', keys: { mod: true, key: 'j' } },
      { id: 'sidebar', label: 'Show or hide the sidebar', keys: { mod: true, key: '\\' } },
      { id: 'shortcuts', label: 'Keyboard shortcuts', keys: { mod: true, key: '/' } },
    ],
  },
  {
    title: 'Desk',
    shortcuts: [
      { id: 'hand', label: 'Hand tool: drag to move the desk', keys: { key: 'h' } },
      { id: 'pan', label: 'Move the desk while held', keys: { key: 'Space' } },
      { id: 'select-all', label: 'Select every sheet', keys: { mod: true, key: 'a' } },
      { id: 'remove', label: 'Take the selected sheets off the desk', keys: { mac: { key: 'Backspace' }, other: { key: 'Delete' } } },
      { id: 'undo', label: 'Undo', keys: { mod: true, key: 'z' } },
      { id: 'redo', label: 'Redo', keys: { mac: { mod: true, shift: true, key: 'z' }, other: { mod: true, key: 'y' } } },
      { id: 'zoom-in', label: 'Zoom in (a focused page or PDF zooms itself)', keys: { mod: true, key: '=' } },
      { id: 'zoom-out', label: 'Zoom out', keys: { mod: true, key: '-' } },
      { id: 'actual-size', label: 'Actual size', keys: { mod: true, key: '0' } },
      { id: 'fit', label: 'Fit everything in view', keys: { mod: true, key: '1' } },
    ],
  },
  {
    title: 'Focus',
    shortcuts: [
      { id: 'focus', label: 'Focus the selected sheet (or double-click it)', keys: { mod: true, key: 'Enter' } },
      { id: 'leave', label: 'Back to the desk', keys: { key: 'Escape' } },
    ],
  },
  {
    title: 'Reading a book or paper',
    shortcuts: [{ id: 'bookmark', label: 'Bookmark the page you’re reading, or remove its bookmark', keys: { mod: true, key: 'd' } }],
  },
  {
    title: 'Pointing with that.',
    shortcuts: [
      { id: 'that', label: 'that.: point at selected words, a video moment or a region', keys: { mod: true, key: '.' } },
      { id: 'region', label: 'Draw a region on a sheet', keys: { alt: true, key: 'Drag' } },
    ],
  },
  {
    title: 'Agent',
    shortcuts: [
      { id: 'send', label: 'Send your question', keys: { key: 'Enter' } },
      { id: 'newline', label: 'New line in your question', keys: { shift: true, key: 'Enter' } },
      { id: 'accept', label: 'Accept the newest proposal', keys: { key: 'Tab' } },
      { id: 'dismiss', label: 'Dismiss the newest proposal', keys: { key: 'Escape' } },
    ],
  },
]

const BY_ID = new Map(SHORTCUTS.flatMap((group) => group.shortcuts.map((shortcut) => [shortcut.id, shortcut] as const)))

/** The keys a frame uses for a binding. */
export function keysOn(frame: Frame, binding: Binding): Keys {
  return 'mac' in binding ? (frame === 'mac' ? binding.mac : binding.other) : binding
}

const MAC_KEYS: Record<string, string> = { Enter: '↩', Escape: 'Esc', Backspace: '⌫', Delete: '⌦', '=': '+', '-': '−', ArrowUp: '↑', ArrowDown: '↓' }
const OTHER_KEYS: Record<string, string> = { Escape: 'Esc', '=': '+', '-': '−', ArrowUp: '↑', ArrowDown: '↓' }

/** How keys read on a frame: ⌥⇧⌘K on a Mac, Ctrl+Alt+Shift+K elsewhere. */
export function keyLabel(frame: Frame, keys: Keys): string {
  const name = (frame === 'mac' ? MAC_KEYS : OTHER_KEYS)[keys.key] ?? (keys.key.length === 1 ? keys.key.toUpperCase() : keys.key)
  if (frame === 'mac') return `${keys.alt ? '⌥' : ''}${keys.shift ? '⇧' : ''}${keys.mod ? '⌘' : ''}${name}`
  return [keys.mod && 'Ctrl', keys.alt && 'Alt', keys.shift && 'Shift', name].filter(Boolean).join('+')
}

/** A shortcut's keys as this frame writes them, by id: "⌘K" or "Ctrl+K". */
export function shortcutLabel(frame: Frame, id: string): string {
  const shortcut = BY_ID.get(id)
  if (!shortcut) throw new Error(`No shortcut "${id}"`)
  return keyLabel(frame, keysOn(frame, shortcut.keys))
}

/** A tooltip: what a control does, then its shortcut. */
export function withShortcut(frame: Frame, text: string, id: string): string {
  return `${text} (${shortcutLabel(frame, id)})`
}

const ACCELERATOR_KEYS: Record<string, string> = { '.': 'Period', '=': 'Plus', '-': '-', Escape: 'Escape', '\\': '\\', '/': '/' }

/** A shortcut in Electron's accelerator form, to show in a native menu: "CommandOrControl+K". */
export function accelerator(id: string, platform: string): string | undefined {
  const shortcut = BY_ID.get(id)
  if (!shortcut) return undefined
  const keys = keysOn(platform === 'darwin' ? 'mac' : 'windows', shortcut.keys)
  if (keys.key === 'Drag') return undefined
  const key = ACCELERATOR_KEYS[keys.key] ?? (keys.key.length === 1 ? keys.key.toUpperCase() : keys.key)
  return [keys.mod && 'CommandOrControl', keys.alt && 'Alt', keys.shift && 'Shift', key].filter(Boolean).join('+')
}
