import { randomUUID } from 'node:crypto'
import { readJson, writeJson } from '@carrel/core'
import type { Day } from './days.js'
import type { MemoryPaths } from './kept.js'

/** The relations a line can have. A fixed set, so lines stay comparable. */
export const RELATIONS = ['builds on', 'same idea', 'why it matters', 'contradicts'] as const
export type Relation = (typeof RELATIONS)[number]

export function isRelation(value: unknown): value is Relation {
  return typeof value === 'string' && (RELATIONS as readonly string[]).includes(value)
}

/**
 * A line between two pieces from different days. `from` is the newer piece,
 * `to` the older one it reaches back to: "Prefix caching builds on Paged attention".
 */
export interface Line {
  id: string
  from: string
  to: string
  relation: Relation
  /** The day of the newer piece; lines drawn on the newest day are the new ones. */
  drawnOn: Day
  drawnAt: string
  /** You removed it. It stays here so it is never drawn again. */
  removedAt?: string
}

/** ~/Carrel/Memory/lines.json: every line ever drawn, removed ones too. */
export class Lines {
  constructor(private readonly paths: MemoryPaths) {}

  async all(): Promise<Line[]> {
    const read = (await readJson(this.paths.lines)) as { lines?: unknown } | undefined
    return Array.isArray(read?.lines) ? read.lines.filter(isLine) : []
  }

  /** Lines not removed. */
  async shown(): Promise<Line[]> {
    return (await this.all()).filter((line) => line.removedAt === undefined)
  }

  /** Adds lines, skipping any pair already joined or ever removed. Returns those added. */
  async add(lines: ReadonlyArray<Omit<Line, 'id' | 'drawnAt'>>, now: Date): Promise<Line[]> {
    const known = await this.all()
    const pairs = new Set(known.map((line) => pairKey(line.from, line.to)))
    const added: Line[] = []
    for (const line of lines) {
      const key = pairKey(line.from, line.to)
      if (line.from === line.to || pairs.has(key)) continue
      pairs.add(key)
      added.push({ id: randomUUID(), drawnAt: now.toISOString(), ...line })
    }
    if (added.length > 0) await this.write([...known, ...added])
    return added
  }

  /** Removes a line for good. Returns it, or undefined when there's no such line. */
  async remove(id: string, now: Date): Promise<Line | undefined> {
    const known = await this.all()
    const line = known.find((candidate) => candidate.id === id)
    if (!line || line.removedAt) return line
    line.removedAt = now.toISOString()
    await this.write(known)
    return line
  }

  /** Removes the lines of a piece that is gone; they stay removed. */
  async removeOf(piece: string, now: Date): Promise<void> {
    const known = await this.all()
    let changed = false
    for (const line of known) {
      if ((line.from === piece || line.to === piece) && !line.removedAt) {
        line.removedAt = now.toISOString()
        changed = true
      }
    }
    if (changed) await this.write(known)
  }

  private async write(lines: Line[]): Promise<void> {
    await writeJson(this.paths.lines, { format: 1, lines })
  }
}

/** The same two pieces, whichever way round. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function isLine(value: unknown): value is Line {
  if (typeof value !== 'object' || value === null) return false
  const line = value as Record<string, unknown>
  return typeof line.id === 'string' && typeof line.from === 'string' && typeof line.to === 'string' && isRelation(line.relation) && typeof line.drawnOn === 'string' && typeof line.drawnAt === 'string'
}
