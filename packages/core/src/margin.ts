import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readJson, writeJson } from './files.js'
import type { Actor, Workspace } from './workspace.js'

/**
 * Lines into the margin: you point at words in a source or a note, and a
 * pencil line ties them to what is written beside them, by you or the agent.
 * Kept in one file with the project:
 *
 * ~/Carrel/<project>/margin.json
 *
 * A line on a source holds the *that.* it points at (the words are found
 * again through it). A line on a note holds the quoted words instead, since
 * a note's text is yours and changes as you write.
 */
export interface MarginEntry {
  by: Actor
  text: string
  /** An agent's answer: its turn in the project thread. */
  turnId?: string
  at: string
}

export interface MarginLine {
  id: string
  /** The source or note the line starts in. */
  itemId: string
  /** On a source: the *that.* it points at. */
  that?: string
  /** On a note: the words it points at. */
  quote?: string
  /** Who drew it: you, or the agent thinking with you. */
  by: Actor
  entries: MarginEntry[]
  createdAt: string
  updatedAt: string
}

/** Whether the agent speaks up on its own in an item ("with"), or waits to be asked ("ask"). */
export type MarginMode = 'with' | 'ask'

export type NewMarginLine = Pick<MarginLine, 'itemId'> & Partial<Pick<MarginLine, 'that' | 'quote'>> & { by?: Actor; entries?: Array<Pick<MarginEntry, 'by' | 'text' | 'turnId'>> }

interface MarginFile {
  format: 1
  lines: MarginLine[]
  modes: Record<string, MarginMode>
}

/** Longest entry and quote kept. */
const TEXT_MAX = 8000
const QUOTE_MAX = 600
/** Most entries in one line's thread. */
const ENTRIES_MAX = 60

export class Margin {
  constructor(
    private readonly workspace: Workspace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async lines(folder: string, itemId?: string): Promise<MarginLine[]> {
    const all = (await this.read(folder)).lines
    return itemId === undefined ? all : all.filter((line) => line.itemId === itemId)
  }

  async draw(folder: string, line: NewMarginLine, actor: Actor = 'user'): Promise<MarginLine> {
    if (!line.that && !line.quote?.trim()) throw new Error('A line has to start at some words.')
    const at = this.now().toISOString()
    const drawn: MarginLine = {
      id: randomUUID(),
      itemId: line.itemId,
      ...(line.that ? { that: line.that } : {}),
      ...(line.quote?.trim() ? { quote: line.quote.trim().slice(0, QUOTE_MAX) } : {}),
      by: line.by ?? actor,
      entries: (line.entries ?? []).flatMap((entry) => (entry.text.trim() ? [entryOf(entry, at)] : [])).slice(0, ENTRIES_MAX),
      createdAt: at,
      updatedAt: at,
    }
    const file = await this.read(folder)
    await this.write(folder, { ...file, lines: [...file.lines, drawn] })
    await this.workspace.event(folder, actor, 'margin.drawn', { id: drawn.id, itemId: drawn.itemId })
    return drawn
  }

  /** Adds to a line's thread: your reply, or the agent's answer. */
  async add(folder: string, id: string, entry: Pick<MarginEntry, 'by' | 'text' | 'turnId'>): Promise<MarginLine> {
    if (!entry.text.trim()) throw new Error('Write something first.')
    const file = await this.read(folder)
    const line = file.lines.find((known) => known.id === id)
    if (!line) throw new Error('That line is no longer in the margin.')
    const at = this.now().toISOString()
    const added: MarginLine = { ...line, entries: [...line.entries, entryOf(entry, at)].slice(-ENTRIES_MAX), updatedAt: at }
    await this.write(folder, { ...file, lines: file.lines.map((known) => (known.id === id ? added : known)) })
    return added
  }

  /** Rubs a line out. What it pointed at is kept. */
  async erase(folder: string, id: string, actor: Actor = 'user'): Promise<void> {
    const file = await this.read(folder)
    if (!file.lines.some((line) => line.id === id)) return
    await this.write(folder, { ...file, lines: file.lines.filter((line) => line.id !== id) })
    await this.workspace.event(folder, actor, 'margin.erased', { id })
  }

  async modes(folder: string): Promise<Record<string, MarginMode>> {
    return (await this.read(folder)).modes
  }

  async setMode(folder: string, itemId: string, mode: MarginMode): Promise<Record<string, MarginMode>> {
    if (mode !== 'with' && mode !== 'ask') throw new Error('The agent either thinks with you or waits to be asked.')
    const file = await this.read(folder)
    const modes = { ...file.modes, [itemId]: mode }
    await this.write(folder, { ...file, modes })
    return modes
  }

  private async read(folder: string): Promise<MarginFile> {
    const file = (await readJson(this.file(folder))) as Partial<MarginFile> | undefined
    return {
      format: 1,
      lines: (Array.isArray(file?.lines) ? file.lines : []).filter(isMarginLine),
      modes: Object.fromEntries(Object.entries(file?.modes ?? {}).filter(([, mode]) => mode === 'with' || mode === 'ask')),
    }
  }

  private write(folder: string, file: MarginFile): Promise<void> {
    return writeJson(this.file(folder), file)
  }

  private file(folder: string): string {
    return join(this.workspace.roots.content, folder, 'margin.json')
  }
}

function entryOf(entry: Pick<MarginEntry, 'by' | 'text' | 'turnId'>, at: string): MarginEntry {
  return { by: entry.by, text: entry.text.trim().slice(0, TEXT_MAX), ...(entry.turnId ? { turnId: entry.turnId } : {}), at }
}

function isMarginLine(value: unknown): value is MarginLine {
  if (typeof value !== 'object' || value === null) return false
  const line = value as Partial<MarginLine>
  return typeof line.id === 'string' && typeof line.itemId === 'string' && Array.isArray(line.entries) && (typeof line.that === 'string' || typeof line.quote === 'string')
}
