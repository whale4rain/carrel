import { addDays, dayOf, type Day } from './days.js'
import { cosine, localEmbedder, VectorCache, type Embedder } from './embed.js'
import { Kept, type Capture, type MemoryPaths } from './kept.js'
import { Lines, pairKey, type Line } from './lines.js'
import { captureHash, newPiece, Pieces, recordCorrection, sourceLabel, type Piece } from './pieces.js'
import { distillPrompt, parseLines, parsePieces, relatePrompt, type Ask, type Candidates } from './prompts.js'
import { recall, type Recalled } from './recall.js'

/** Older pieces looked at for each new one. */
const CANDIDATES = 6
/** How alike two pieces must look before the agent is asked about them. */
const MIN_SIMILARITY = 0.05
/** Recent removals shown to the agent as lines not to draw. */
const REMOVED_EXAMPLES = 12
/** A capture shorter than this (in characters) and with no reason has nothing to distill. */
const MIN_TEXT = 20

export interface MemoryEngineOptions {
  paths: MemoryPaths
  /** The model, asked with no tools. */
  ask: Ask
  embedder?: Embedder
  now?: () => Date
}

export interface Distilled {
  day: Day
  /** Pieces made in this run. */
  pieces: Piece[]
  /** Lines drawn in this run. */
  lines: Line[]
}

/**
 * The memory engine (phase 2): turns a day's captures into pieces, finds
 * older pieces that may be related by their vectors, asks the agent which
 * are and how, and keeps the lines. Lines you removed never come back, and
 * every correction is kept as data.
 */
export class MemoryEngine {
  readonly kept: Kept
  readonly pieces: Pieces
  readonly lines: Lines
  private readonly paths: MemoryPaths
  private readonly ask: Ask
  private readonly vectors: VectorCache
  private readonly now: () => Date
  /** One change at a time, so day files never interleave. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: MemoryEngineOptions) {
    this.paths = options.paths
    this.now = options.now ?? (() => new Date())
    this.kept = new Kept(options.paths, this.now)
    this.pieces = new Pieces(options.paths)
    this.lines = new Lines(options.paths)
    this.ask = options.ask
    this.vectors = new VectorCache(options.paths, options.embedder ?? localEmbedder)
  }

  /** Turns what was kept on a day, and not distilled yet, into pieces, then draws their lines. */
  distill(day: Day): Promise<Distilled> {
    return this.serial(async () => {
      const file = await this.pieces.day(day)
      const fresh = (await this.kept.day(day)).filter((capture) => file.distilled[capture.key] !== captureHash(capture))
      const worth = fresh.filter((capture) => capture.text.trim().length >= MIN_TEXT || capture.reason)
      let added: Piece[] = []
      if (worth.length > 0) {
        const groups = [...new Set((await this.pieces.all()).map((piece) => piece.group))]
        const { system, user } = distillPrompt(day, worth, file.pieces, groups)
        const answer = await this.ask(system, user)
        const made = new Set(file.pieces.map((piece) => piece.title.toLowerCase()))
        const now = this.now()
        added = parsePieces(answer, worth.length).flatMap((found) => {
          if (made.has(found.title.toLowerCase())) return []
          made.add(found.title.toLowerCase())
          const behind = found.from.map((n) => worth[n - 1]!)
          return [newPiece(day, { title: found.title, body: found.body, group: found.group, source: sourceOf(behind[0]!), captures: behind.map((capture) => capture.key) }, now)]
        })
        file.pieces.push(...added)
        file.cost = { calls: (file.cost?.calls ?? 0) + 1, bytes: (file.cost?.bytes ?? 0) + byteLength(system) + byteLength(user) }
      }
      if (fresh.length === 0) return { day, pieces: [], lines: [] }
      for (const capture of fresh) file.distilled[capture.key] = captureHash(capture)
      file.distilledAt = this.now().toISOString()
      await this.pieces.save(file)
      const lines = added.length > 0 ? await this.relate(added) : []
      return { day, pieces: added, lines }
    })
  }

  /** Days up to `today` with captures not yet distilled, oldest first; `back` days at most. */
  async pending(today: Day, back = 7): Promise<Day[]> {
    const days = (await this.kept.days()).filter((day) => day <= today && day >= addDays(today, -back))
    const waiting: Day[] = []
    for (const day of days) {
      const file = await this.pieces.day(day)
      if ((await this.kept.day(day)).some((capture) => file.distilled[capture.key] !== captureHash(capture))) waiting.push(day)
    }
    return waiting
  }

  /** You changed a piece's words. Kept as a correction. */
  editPiece(id: string, change: { title?: string; body?: string }): Promise<Piece> {
    return this.serial(async () => {
      const { file, piece } = await this.find(id)
      const before = { title: piece.title, body: piece.body }
      const title = change.title?.replace(/\s+/g, ' ').trim()
      if (title) piece.title = title.slice(0, 120)
      if (change.body !== undefined) piece.body = change.body.trim().slice(0, 2000)
      if (piece.title === before.title && piece.body === before.body) return piece
      piece.edited = true
      await this.pieces.save(file)
      await recordCorrection(this.paths, { type: 'piece.edited', at: this.now().toISOString(), piece: id, before, after: { title: piece.title, body: piece.body } })
      return piece
    })
  }

  /** You removed a piece; its lines go with it, for good. */
  removePiece(id: string): Promise<void> {
    return this.serial(async () => {
      const { file, piece } = await this.find(id)
      file.pieces = file.pieces.filter((other) => other.id !== id)
      await this.pieces.save(file)
      await this.lines.removeOf(id, this.now())
      await recordCorrection(this.paths, { type: 'piece.removed', at: this.now().toISOString(), piece: id, title: piece.title })
    })
  }

  /** You removed a line: it is never drawn again, and the agent sees it as an example. */
  removeLine(id: string): Promise<void> {
    return this.serial(async () => {
      const line = await this.lines.remove(id, this.now())
      if (!line) throw new Error('That line is not there.')
      const pieces = new Map((await this.pieces.all()).map((piece) => [piece.id, piece]))
      await recordCorrection(this.paths, {
        type: 'line.removed',
        at: this.now().toISOString(),
        line: id,
        a: line.from,
        b: line.to,
        relation: line.relation,
        titles: [pieces.get(line.from)?.title ?? '', pieces.get(line.to)?.title ?? ''],
      })
    })
  }

  /** Finds pieces, and things never made into pieces, by cues: time, source and topic. */
  async recall(query: string, limit?: number): Promise<Recalled[]> {
    const pieces = await this.pieces.all()
    const captures: Capture[] = []
    for (const day of await this.kept.days()) captures.push(...(await this.kept.day(day)))
    return recall(query, dayOf(this.now()), pieces, captures, limit)
  }

  /** Draws lines from new pieces to pieces of other days. */
  private async relate(added: readonly Piece[]): Promise<Line[]> {
    const all = await this.pieces.all()
    const known = await this.lines.all()
    const joined = new Set(known.map((line) => pairKey(line.from, line.to)))
    const fresh = new Set(added.map((piece) => piece.id))
    const others = all.filter((piece) => !fresh.has(piece.id))
    if (others.length === 0) return []
    const text = (piece: Piece): string => `${piece.title}. ${piece.body} ${piece.group}`
    const [mine, theirs] = await Promise.all([this.vectors.vectors(added.map(text)), this.vectors.vectors(others.map(text))])
    const sets: Candidates[] = []
    added.forEach((piece, index) => {
      const older = others
        .map((other, n) => ({ other, similarity: cosine(mine[index]!, theirs[n]!) }))
        .filter(({ other, similarity }) => other.day !== piece.day && similarity >= MIN_SIMILARITY && !joined.has(pairKey(piece.id, other.id)))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, CANDIDATES)
        .map(({ other }) => other)
      if (older.length > 0) sets.push({ piece, older })
    })
    if (sets.length === 0) return []
    const byId = new Map(all.map((piece) => [piece.id, piece]))
    const removed = known
      .filter((line) => line.removedAt)
      .slice(-REMOVED_EXAMPLES)
      .flatMap((line) => {
        const from = byId.get(line.from)
        const to = byId.get(line.to)
        return from && to ? [{ from: from.title, to: to.title, relation: line.relation }] : []
      })
    const { system, user, refs } = relatePrompt(sets, removed)
    const answer = await this.ask(system, user)
    const today = dayOf(this.now())
    const drawn = parseLines(answer, sets, refs).map(({ from, to, relation }) => {
      const [newer, older] = from.day >= to.day ? [from, to] : [to, from]
      return { from: newer.id, to: older.id, relation, drawnOn: today }
    })
    // The model call counts toward the day of the pieces it was for.
    const day = added[0]!.day
    const file = await this.pieces.day(day)
    file.cost = { calls: (file.cost?.calls ?? 0) + 1, bytes: (file.cost?.bytes ?? 0) + byteLength(system) + byteLength(user) }
    await this.pieces.save(file)
    return this.lines.add(drawn, this.now())
  }

  private async find(id: string): Promise<{ file: Awaited<ReturnType<Pieces['day']>>; piece: Piece }> {
    for (const day of await this.pieces.days()) {
      const file = await this.pieces.day(day)
      const piece = file.pieces.find((candidate) => candidate.id === id)
      if (piece) return { file, piece }
    }
    throw new Error('That piece is not there.')
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run)
    this.queue = next.catch(() => undefined)
    return next
  }
}

function sourceOf(capture: Capture): Piece['source'] {
  return { label: sourceLabel(capture), kind: capture.kind, from: capture.from, title: capture.title, ...(capture.url ? { url: capture.url } : {}), at: capture.at }
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}
