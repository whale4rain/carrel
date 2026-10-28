import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { carrelRoots, isMissing, type CarrelRoots } from '@carrel/core'
import { dayOf, isDay, type Day } from './days.js'

/**
 * Where memory lives (decided 28 Oct). It belongs to you, not to a project,
 * so it sits beside the projects:
 *
 * ~/Carrel/Memory/
 *   kept/YYYY-MM-DD.jsonl     everything kept that day, a JSON line per capture
 *   kept/files/<id>.png       screenshots
 *   pieces/YYYY-MM-DD.json    the day's pieces
 *   lines.json                lines between pieces, removed ones too
 *   corrections.jsonl         what you changed, for the engine to learn from
 * ~/.carrel/memory/           settings, chat cursors, the embeddings cache
 */
export const MEMORY_FOLDER = 'Memory'

export interface MemoryPaths {
  /** ~/Carrel/Memory */
  root: string
  kept: string
  files: string
  pieces: string
  lines: string
  corrections: string
  /** ~/.carrel/memory */
  internal: string
}

export function memoryPaths(roots: CarrelRoots = carrelRoots()): MemoryPaths {
  const root = join(roots.content, MEMORY_FOLDER)
  return {
    root,
    kept: join(root, 'kept'),
    files: join(root, 'kept', 'files'),
    pieces: join(root, 'pieces'),
    lines: join(root, 'lines.json'),
    corrections: join(root, 'corrections.jsonl'),
    internal: join(roots.internal, 'memory'),
  }
}

/** What a capture is: a conversation, a page or words you kept, a screenshot, or a page you read. */
export type CaptureKind = 'chat' | 'page' | 'selection' | 'screenshot' | 'visit'
/** How it came in: a chat source, an import, the Keep shortcut, or the reading trail. */
export type CaptureFrom = 'tnega' | 'carrel' | 'chatgpt' | 'keep' | 'trail'

export const CAPTURE_KINDS: readonly CaptureKind[] = ['chat', 'page', 'selection', 'screenshot', 'visit']
export const CAPTURE_FROM: readonly CaptureFrom[] = ['tnega', 'carrel', 'chatgpt', 'keep', 'trail']

export interface Capture {
  id: string
  /** Captures with the same key are one thing; the latest line wins (a chat that grows all day). */
  key: string
  /** When it happened (a chat: its last turn that day). */
  at: string
  kind: CaptureKind
  from: CaptureFrom
  title: string
  /** Its words: a chat's turns, a page's text, the words selected. */
  text: string
  url?: string
  /** Why you kept it, in your words. */
  reason?: string
  /** A screenshot's file, in kept/files/. */
  image?: string
}

export type NewCapture = Omit<Capture, 'id' | 'at' | 'key'> & { at?: string; key?: string }

/** Longest text a capture keeps; the rest of a long page or chat is cut. */
export const CAPTURE_TEXT = 20_000

/** The day files of kept captures: append-only, read with the latest line per key. */
export class Kept {
  readonly paths: MemoryPaths
  private readonly now: () => Date

  constructor(paths: MemoryPaths, now: () => Date = () => new Date()) {
    this.paths = paths
    this.now = now
  }

  async add(capture: NewCapture): Promise<Capture> {
    const at = capture.at ?? this.now().toISOString()
    const id = randomUUID()
    const kept: Capture = {
      ...capture,
      id,
      at,
      key: capture.key ?? `${capture.kind}:${id}`,
      title: oneLine(capture.title).slice(0, 300) || 'Untitled',
      text: capture.text.slice(0, CAPTURE_TEXT),
    }
    if (kept.reason !== undefined) kept.reason = oneLine(kept.reason).slice(0, 500)
    if (kept.reason === '') delete kept.reason
    await mkdir(this.paths.kept, { recursive: true })
    await appendFile(this.dayFile(dayOf(at)), `${JSON.stringify(kept)}\n`, 'utf8')
    return kept
  }

  /** A screenshot, kept beside the day files. Returns its file name. */
  async saveImage(png: Uint8Array): Promise<string> {
    const name = `${randomUUID()}.png`
    await mkdir(this.paths.files, { recursive: true })
    await writeFile(join(this.paths.files, name), png)
    return name
  }

  imagePath(name: string): string {
    if (!/^[\w-]+\.png$/.test(name)) throw new Error('That is not a kept screenshot.')
    return join(this.paths.files, name)
  }

  /** A day's captures, oldest first, the latest of each key. Lines that can't be read are skipped. */
  async day(day: Day): Promise<Capture[]> {
    let text: string
    try {
      text = await readFile(this.dayFile(day), 'utf8')
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const latest = new Map<string, Capture>()
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const capture = JSON.parse(line) as unknown
        if (!isCapture(capture)) continue
        latest.delete(capture.key)
        latest.set(capture.key, capture)
      } catch {
        // A torn line from a crash; the rest of the day still reads.
      }
    }
    return [...latest.values()].sort((a, b) => a.at.localeCompare(b.at))
  }

  /** Days with anything kept, oldest first. */
  async days(): Promise<Day[]> {
    let names: string[]
    try {
      names = await readdir(this.paths.kept)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    return names
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => name.slice(0, -'.jsonl'.length))
      .filter(isDay)
      .sort()
  }

  private dayFile(day: Day): string {
    if (!isDay(day)) throw new Error(`"${day}" is not a day.`)
    return join(this.paths.kept, `${day}.jsonl`)
  }
}

export function isCapture(value: unknown): value is Capture {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.key === 'string' &&
    typeof c.at === 'string' &&
    !Number.isNaN(Date.parse(c.at)) &&
    CAPTURE_KINDS.includes(c.kind as CaptureKind) &&
    CAPTURE_FROM.includes(c.from as CaptureFrom) &&
    typeof c.title === 'string' &&
    typeof c.text === 'string'
  )
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
