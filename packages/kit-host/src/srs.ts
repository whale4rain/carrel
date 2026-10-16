/**
 * Spaced review, shared by every kit (`kit.srs.schedule`). A card's state is
 * kept by the kit in its own store; the host only works out the next one
 * from the last and how the review went. It is SM-2, simplified: four
 * answers, an ease per card, and a short relearning step after a miss.
 */

export const GRADES = ['again', 'hard', 'good', 'easy'] as const
export type Grade = (typeof GRADES)[number]

export interface ReviewState {
  /** When it is next due, as an ISO time. */
  due: string
  /** Days to the next review (0 while relearning). */
  interval: number
  /** How fast the interval grows; 1.3 at the least. */
  ease: number
  /** Reviews in a row without a miss. */
  reps: number
  /** Times it was missed. */
  lapses: number
  /** When it was last reviewed. */
  last?: string
}

const DAY = 24 * 60 * 60 * 1000
const RELEARN = 10 * 60 * 1000
const MIN_EASE = 1.3
/** The longest gap, so nothing drops out for good. */
const MAX_INTERVAL = 365

/** A card never reviewed: due now. */
export function newReview(now: Date): ReviewState {
  return { due: now.toISOString(), interval: 0, ease: 2.5, reps: 0, lapses: 0 }
}

export function schedule(state: ReviewState | null | undefined, grade: Grade, now: Date): ReviewState {
  const from = state ?? newReview(now)
  const round = (days: number): number => Math.min(MAX_INTERVAL, Math.max(1, Math.round(days)))
  let { interval, ease, reps, lapses } = from
  if (grade === 'again') {
    lapses += 1
    reps = 0
    ease = Math.max(MIN_EASE, ease - 0.2)
    return { due: new Date(now.getTime() + RELEARN).toISOString(), interval: 0, ease: two(ease), reps, lapses, last: now.toISOString() }
  }
  if (grade === 'hard') {
    interval = reps === 0 ? 1 : round(Math.max(interval + 1, interval * 1.2))
    ease = Math.max(MIN_EASE, ease - 0.15)
  } else if (grade === 'good') {
    interval = reps === 0 ? 1 : reps === 1 ? 3 : round(Math.max(interval + 1, interval * ease))
  } else {
    interval = reps === 0 ? 4 : round(Math.max(interval + 2, interval * ease * 1.3))
    ease += 0.15
  }
  reps += 1
  return { due: new Date(now.getTime() + interval * DAY).toISOString(), interval, ease: two(ease), reps, lapses, last: now.toISOString() }
}

/** A review state handed in by a kit, checked; null when there was none. */
export function reviewState(value: unknown): ReviewState | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('A review state is an object: { due, interval, ease, reps, lapses }.')
  const state = value as Record<string, unknown>
  const number = (field: string, min: number): number => {
    const n = state[field]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min) throw new Error(`A review state needs ${field} as a number from ${min}.`)
    return n
  }
  if (typeof state.due !== 'string' || Number.isNaN(Date.parse(state.due))) throw new Error('A review state needs due as a time.')
  return { due: state.due, interval: number('interval', 0), ease: Math.max(MIN_EASE, number('ease', 0)), reps: Math.floor(number('reps', 0)), lapses: Math.floor(number('lapses', 0)) }
}

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'string' && (GRADES as readonly string[]).includes(value)
}

function two(n: number): number {
  return Math.round(n * 100) / 100
}
