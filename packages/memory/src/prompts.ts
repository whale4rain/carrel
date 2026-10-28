import { dayLabel, type Day } from './days.js'
import type { Capture } from './kept.js'
import { isRelation, RELATIONS, type Relation } from './lines.js'
import type { Piece } from './pieces.js'

/** Asks the model once, with no tools: a system prompt and a message. Resolves with its answer. */
export type Ask = (system: string, user: string) => Promise<string>

/** First words of the distilling prompt; a stand-in model knows it by them. */
export const DISTILL_MARK = 'Carrel memory: distill one day.'
/** First words of the line-drawing prompt. */
export const RELATE_MARK = 'Carrel memory: draw lines.'

/** Most characters of captures sent for one day. */
const DAY_BUDGET = 48_000
/** Most characters of one capture. */
const CAPTURE_BUDGET = 6_000

export const MAX_PIECES = 8
/** Most lines one new piece gets. */
export const MAX_LINES = 3

/** What the person changed in earlier pieces, shown to the model as examples. */
export interface PieceCorrections {
  /** Titles of pieces they removed. */
  removed: string[]
  /** Pieces they reworded. */
  edited: Array<{ before: string; after: string }>
}

export function distillPrompt(day: Day, captures: readonly Capture[], made: readonly Piece[], groups: readonly string[], corrections: PieceCorrections = { removed: [], edited: [] }): { system: string; user: string } {
  const system = [
    DISTILL_MARK,
    'You are the memory of Carrel, a study app. You turn one day of what a person read, asked and kept into a few pieces: things they found or understood that day.',
    '',
    'Rules:',
    `- Up to ${MAX_PIECES} pieces for a full day, fewer for a light one, none when nothing was learned (logins, chores, small talk).`,
    "- title: the idea itself, at most 9 words, like 'Prefix caching reuses KV blocks'. Not a topic name.",
    '- body: 1 to 3 plain sentences that explain it, in the language the captures are written in.',
    '- group: a short topic, 1 to 3 words. Reuse an existing group when it fits.',
    '- from: the numbers of the captures it came from.',
    '- A reason the person gave for keeping something says what mattered to them.',
    '- Never quiz, advise or address the person. No "you learned", no praise.',
    '',
    'Answer with JSON only: {"pieces":[{"title":"…","body":"…","group":"…","from":[1]}]}',
  ].join('\n')
  const budget = Math.max(800, Math.min(CAPTURE_BUDGET, Math.floor(DAY_BUDGET / Math.max(1, captures.length))))
  const lines = [`Day: ${dayLabel(day)} (${day})`]
  if (groups.length > 0) lines.push(`Existing groups: ${groups.join('; ')}`)
  if (made.length > 0) lines.push('Pieces already made today (do not repeat them):', ...made.map((piece) => `- ${piece.title}`))
  if (corrections.removed.length > 0) lines.push('Pieces the person removed (do not make pieces like these):', ...corrections.removed.map((title) => `- ${title}`))
  if (corrections.edited.length > 0) lines.push('Pieces the person reworded (write the way they did):', ...corrections.edited.map(({ before, after }) => `- "${before}" became "${after}"`))
  lines.push('', 'Captures:')
  captures.forEach((capture, index) => {
    const head = [`[${index + 1}] ${capture.kind} from ${capture.from}: ${capture.title}`]
    if (capture.url) head.push(`url: ${capture.url}`)
    if (capture.reason) head.push(`kept because: ${capture.reason}`)
    lines.push(head.join('\n'), clip(capture.text, budget), '')
  })
  return { system, user: lines.join('\n') }
}

export interface DistilledPiece {
  title: string
  body: string
  group: string
  from: number[]
}

/** The pieces in the model's answer; anything malformed is left out. `count` is how many captures were sent. */
export function parsePieces(answer: string, count: number): DistilledPiece[] {
  const data = jsonIn(answer) as { pieces?: unknown } | undefined
  if (!data || !Array.isArray(data.pieces)) throw new Error('The model did not answer with pieces.')
  const pieces: DistilledPiece[] = []
  for (const raw of data.pieces as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const piece = raw as Record<string, unknown>
    const title = typeof piece.title === 'string' ? oneLine(piece.title).slice(0, 120) : ''
    const body = typeof piece.body === 'string' ? piece.body.trim().slice(0, 800) : ''
    const group = typeof piece.group === 'string' ? oneLine(piece.group).slice(0, 40) : ''
    const from = Array.isArray(piece.from) ? [...new Set(piece.from.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= count))] : []
    if (!title || from.length === 0) continue
    pieces.push({ title, body, group: group || 'Loose ends', from })
    if (pieces.length === MAX_PIECES) break
  }
  return pieces
}

export interface Candidates {
  piece: Piece
  /** Older pieces from other days that may be related, closest first. */
  older: Piece[]
}

export function relatePrompt(sets: readonly Candidates[], removed: ReadonlyArray<{ from: string; to: string; relation: string }>): { system: string; user: string; refs: Map<string, Piece> } {
  const system = [
    RELATE_MARK,
    'You draw lines between pieces of what a person learned on different days.',
    'For each new piece you get a few older pieces that may be related. Draw a line only when the relation is real and specific:',
    '- "builds on": the new piece rests on the older one.',
    '- "same idea": the same mechanism or pattern, seen in another place.',
    '- "why it matters": one explains why the other matters.',
    '- "contradicts": they disagree.',
    `Most candidates get no line. At most ${MAX_LINES} lines per new piece. Sharing a word or a topic is not enough.`,
    'Never write to the person; only draw.',
    '',
    'Answer with JSON only: {"lines":[{"new":1,"old":"c2","relation":"builds on"}]}',
  ].join('\n')
  const refs = new Map<string, Piece>()
  const lines: string[] = []
  if (removed.length > 0) lines.push('Lines the person removed before; do not draw lines like these:', ...removed.map((line) => `- "${line.from}" ${line.relation} "${line.to}"`), '')
  let next = 1
  sets.forEach((set, index) => {
    lines.push(`New piece ${index + 1} (${dayLabel(set.piece.day)}): ${set.piece.title}. ${clip(set.piece.body, 400)}`, 'Older pieces:')
    for (const old of set.older) {
      const ref = `c${next++}`
      refs.set(ref, old)
      lines.push(`  ${ref} (${dayLabel(old.day)}): ${old.title}. ${clip(old.body, 300)}`)
    }
    lines.push('')
  })
  return { system, user: lines.join('\n'), refs }
}

/** The lines in the model's answer that join a new piece to one of its own candidates. */
export function parseLines(answer: string, sets: readonly Candidates[], refs: ReadonlyMap<string, Piece>): Array<{ from: Piece; to: Piece; relation: Relation }> {
  const data = jsonIn(answer) as { lines?: unknown } | undefined
  if (!data || !Array.isArray(data.lines)) throw new Error('The model did not answer with lines.')
  const found: Array<{ from: Piece; to: Piece; relation: Relation }> = []
  const perPiece = new Map<string, number>()
  for (const raw of data.lines as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const line = raw as Record<string, unknown>
    const set = typeof line.new === 'number' ? sets[line.new - 1] : undefined
    const old = typeof line.old === 'string' ? refs.get(line.old.trim()) : undefined
    const relation = typeof line.relation === 'string' ? line.relation.trim().toLowerCase() : ''
    if (!set || !old || !isRelation(relation) || !set.older.includes(old)) continue
    const count = perPiece.get(set.piece.id) ?? 0
    if (count >= MAX_LINES) continue
    perPiece.set(set.piece.id, count + 1)
    found.push({ from: set.piece, to: old, relation })
  }
  return found
}

export { RELATIONS }

/** The JSON object in an answer, which may come in a code fence or with words around it. */
export function jsonIn(answer: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(answer)?.[1]
  const text = (fenced ?? answer).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
