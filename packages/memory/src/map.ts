import { addDays, dayLabel, daysBetween, type Day } from './days.js'
import type { Line } from './lines.js'
import type { Piece } from './pieces.js'

/**
 * The map's layout (phase 3): pieces placed by day from left to right, in
 * loose bands by group, and the lines between them. Pure, so the renderer
 * can draw it and tests can check it; nothing here reads files.
 */

export type MapRange = '2w' | 'month' | 'all'

export const MAP_RANGES: ReadonlyArray<{ id: MapRange; label: string }> = [
  { id: '2w', label: '2 weeks' },
  { id: 'month', label: 'Month' },
  { id: 'all', label: 'All' },
]

/** The group a piece the agent could not place goes in; drawn last. */
export const LOOSE_ENDS = 'Loose ends'

export const CARD = { width: 142, height: 66 }
const ROW = 80
const BAND_HEAD = 30
const BAND_GAP = 18
const PAD = { left: 24, right: 24, top: 16 }
const AXIS = 44
const GAP = 10
/** The least room a day gets; a narrow window scrolls sideways instead of stacking every card. */
const MIN_DAY = 68

export interface MapCard {
  piece: Piece
  x: number
  y: number
  /** Made today. */
  today: boolean
}

export interface MapLine {
  line: Line
  /** An SVG path from the older card to the newer one. */
  d: string
  /** Drawn today: highlighted; earlier lines are grey. */
  fresh: boolean
}

export interface MapBand {
  name: string
  y: number
  height: number
}

export interface MapLayout {
  width: number
  height: number
  first: Day
  today: Day
  bands: MapBand[]
  cards: MapCard[]
  lines: MapLine[]
  /** Days named under the map. */
  ticks: Array<{ day: Day; x: number; label: string }>
}

/** The first day a range shows; for "all", the oldest piece's day. */
export function rangeStart(range: MapRange, today: Day, pieces: readonly Pick<Piece, 'day'>[] = []): Day {
  if (range === '2w') return addDays(today, -13)
  if (range === 'month') return addDays(today, -29)
  const oldest = pieces.reduce<Day>((min, piece) => (piece.day < min ? piece.day : min), today)
  return oldest
}

/** Lays out the pieces from `first` to `today` and the shown lines between them, at least `width` pixels wide. */
export function mapLayout(pieces: readonly Piece[], lines: readonly Line[], options: { today: Day; first: Day; width: number }): MapLayout {
  const { today, first } = options
  const span = Math.max(1, daysBetween(first, today))
  const width = Math.max(options.width, 480, PAD.left + PAD.right + CARD.width + span * MIN_DAY)
  const inRange = pieces.filter((piece) => piece.day >= first && piece.day <= today).sort((a, b) => a.day.localeCompare(b.day) || a.createdAt.localeCompare(b.createdAt))
  const usable = width - PAD.left - PAD.right - CARD.width
  const xOf = (day: Day): number => PAD.left + Math.round((daysBetween(first, day) / span) * usable)

  // Bands: the busiest group first, loose ends last.
  const counts = new Map<string, number>()
  for (const piece of inRange) counts.set(piece.group, (counts.get(piece.group) ?? 0) + 1)
  const names = [...counts.keys()].sort((a, b) => (a === LOOSE_ENDS ? 1 : b === LOOSE_ENDS ? -1 : (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b)))

  const bands: MapBand[] = []
  const cards: MapCard[] = []
  let y = PAD.top
  for (const name of names) {
    // Each card takes the first row in its band where it doesn't overlap the card before it.
    const ends: number[] = []
    const placed: Array<{ piece: Piece; x: number; row: number }> = []
    for (const piece of inRange.filter((candidate) => candidate.group === name)) {
      const x = xOf(piece.day)
      let row = ends.findIndex((end) => end + GAP <= x)
      if (row < 0) row = ends.push(0) - 1
      ends[row] = x + CARD.width
      placed.push({ piece, x, row })
    }
    const height = BAND_HEAD + ends.length * ROW
    bands.push({ name, y, height })
    for (const { piece, x, row } of placed) cards.push({ piece, x, y: y + BAND_HEAD + row * ROW, today: piece.day === today })
    y += height + BAND_GAP
  }

  const at = new Map(cards.map((card) => [card.piece.id, card]))
  const drawn: MapLine[] = []
  for (const line of lines) {
    if (line.removedAt) continue
    const a = at.get(line.from)
    const b = at.get(line.to)
    if (!a || !b) continue
    drawn.push({ line, d: curve(a, b), fresh: line.drawnOn === today })
  }
  // Fresh lines last, so they draw over the grey ones.
  drawn.sort((a, b) => Number(a.fresh) - Number(b.fresh))

  const height = Math.max(y, PAD.top + 120) + AXIS
  const every = span <= 14 ? 2 : span <= 31 ? 5 : Math.ceil(span / 8)
  const ticks: MapLayout['ticks'] = []
  for (let n = span; n >= 0; n -= every) {
    const day = addDays(first, n)
    ticks.unshift({ day, x: xOf(day) + CARD.width / 2, label: day === today ? 'Today' : dayLabel(day) })
  }
  return { width, height, first, today, bands, cards, lines: drawn, ticks }
}

/** A soft curve from the older card's right side to the newer card's left side. */
function curve(a: MapCard, b: MapCard): string {
  const [older, newer] = a.piece.day <= b.piece.day ? [a, b] : [b, a]
  const mid = CARD.height / 2
  let x1 = older.x + CARD.width
  let x2 = newer.x
  // Cards that overlap in x join top to bottom instead.
  if (x2 < x1) {
    x1 = older.x + CARD.width / 2
    x2 = newer.x + CARD.width / 2
    const [top, bottom] = older.y <= newer.y ? [older, newer] : [newer, older]
    const y1 = top.y + CARD.height
    const y2 = bottom.y
    const bend = Math.max(20, (y2 - y1) / 2)
    return top === older ? `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}` : `M ${x2} ${y1} C ${x2} ${y1 + bend}, ${x1} ${y2 - bend}, ${x1} ${y2}`
  }
  const y1 = older.y + mid
  const y2 = newer.y + mid
  const bend = (x2 - x1) / 2
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}
