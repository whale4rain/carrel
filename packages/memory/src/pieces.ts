import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isMissing, readJson, writeJson } from '@carrel/core'
import { isDay, type Day } from './days.js'
import type { Capture, CaptureFrom, CaptureKind, MemoryPaths } from './kept.js'

/** Where a piece came from, as its card says it: "Blog", "X post", "Chat", "LeetCode 146". */
export interface PieceSource {
  label: string
  kind: CaptureKind
  from: CaptureFrom
  title: string
  url?: string
  /** When it was read, asked or kept. */
  at: string
}

/** Something you found or understood on a day, in a title and a few plain sentences. */
export interface Piece {
  id: string
  day: Day
  title: string
  body: string
  /** A loose topic the agent noticed ("Agents & inference"); a grouping, not a folder. */
  group: string
  source: PieceSource
  /** The captures behind it, by key. */
  captures: string[]
  createdAt: string
  /** You changed its words. */
  edited?: boolean
}

export interface DayPieces {
  format: 1
  day: Day
  pieces: Piece[]
  /** The captures already turned into pieces, by key, with a hash of what they said then. */
  distilled: Record<string, string>
  distilledAt?: string
  /** Pieces made but still waiting for their lines (the model call for them failed). */
  unrelated?: string[]
  /** What distilling this day sent to the model, every run together. */
  cost?: { calls: number; bytes: number }
}

/** The day files of pieces: ~/Carrel/Memory/pieces/YYYY-MM-DD.json. */
export class Pieces {
  constructor(private readonly paths: MemoryPaths) {}

  async day(day: Day): Promise<DayPieces> {
    const read = (await readJson(this.file(day))) as Partial<DayPieces> | undefined
    return {
      format: 1,
      day,
      pieces: Array.isArray(read?.pieces) ? read.pieces.filter(isPiece) : [],
      distilled: typeof read?.distilled === 'object' && read.distilled !== null ? read.distilled : {},
      ...(typeof read?.distilledAt === 'string' ? { distilledAt: read.distilledAt } : {}),
      ...(read?.cost ? { cost: read.cost } : {}),
      ...(Array.isArray(read?.unrelated) && read.unrelated.length > 0 ? { unrelated: read.unrelated.filter((id): id is string => typeof id === 'string') } : {}),
    }
  }

  async save(file: DayPieces): Promise<void> {
    await writeJson(this.file(file.day), file)
  }

  /** Days with pieces, oldest first. */
  async days(): Promise<Day[]> {
    let names: string[]
    try {
      names = await readdir(this.paths.pieces)
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    return names
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter(isDay)
      .sort()
  }

  /** Every piece, oldest day first. */
  async all(): Promise<Piece[]> {
    const pieces: Piece[] = []
    for (const day of await this.days()) pieces.push(...(await this.day(day)).pieces)
    return pieces
  }

  private file(day: Day): string {
    if (!isDay(day)) throw new Error(`"${day}" is not a day.`)
    return join(this.paths.pieces, `${day}.json`)
  }
}

export function newPiece(day: Day, fields: Omit<Piece, 'id' | 'day' | 'createdAt'>, now: Date): Piece {
  return { id: randomUUID(), day, createdAt: now.toISOString(), ...fields }
}

/** A hash of what a capture says, so a chat that grew is distilled again. */
export function captureHash(capture: Capture): string {
  return createHash('sha256').update(capture.title).update('\n').update(capture.text).update('\n').update(capture.reason ?? '').digest('hex').slice(0, 16)
}

/** Where a piece came from, in the words its card uses. */
export function sourceLabel(capture: Pick<Capture, 'kind' | 'from' | 'url' | 'title'>): string {
  if (capture.kind === 'chat') return capture.from === 'chatgpt' ? 'ChatGPT' : 'Chat'
  if (capture.kind === 'screenshot') return 'Screenshot'
  const host = hostOf(capture.url)
  if (host === 'x.com' || host === 'twitter.com') return 'X post'
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'vimeo.com' || host === 'bilibili.com') return 'Video'
  if (host === 'arxiv.org' || host === 'openreview.net' || host === 'aclanthology.org' || /\.pdf($|\?)/i.test(capture.url ?? '')) return 'Paper'
  if (host === 'leetcode.com' || host === 'leetcode.cn') {
    const number = /^(\d+)\./.exec(capture.title)?.[1]
    return number ? `LeetCode ${number}` : 'LeetCode'
  }
  if (host === 'github.com') return 'Code'
  if (capture.kind === 'selection') return host ? 'Page' : 'Kept words'
  return host ? (/blog|medium\.com|substack\.com|dev\.to/.test(host) ? 'Blog' : 'Page') : 'Kept'
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^(www|m|mobile)\./, '')
    return host.split('.').slice(-2).join('.') === 'youtube.com' ? 'youtube.com' : host
  } catch {
    return undefined
  }
}

function isPiece(value: unknown): value is Piece {
  if (typeof value !== 'object' || value === null) return false
  const piece = value as Record<string, unknown>
  return typeof piece.id === 'string' && isDay(piece.day) && typeof piece.title === 'string' && typeof piece.body === 'string' && typeof piece.group === 'string' && typeof piece.source === 'object' && piece.source !== null && Array.isArray(piece.captures)
}

/** What you changed, kept as data the engine learns from: ~/Carrel/Memory/corrections.jsonl. */
export type Correction =
  | { type: 'line.removed'; at: string; line: string; a: string; b: string; relation: string; titles: [string, string] }
  | { type: 'piece.edited'; at: string; piece: string; before: { title: string; body: string }; after: { title: string; body: string } }
  | { type: 'piece.removed'; at: string; piece: string; title: string }

export async function recordCorrection(paths: MemoryPaths, correction: Correction): Promise<void> {
  await mkdir(dirname(paths.corrections), { recursive: true })
  await appendFile(paths.corrections, `${JSON.stringify(correction)}\n`, 'utf8')
}
