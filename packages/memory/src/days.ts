/**
 * Days, the unit memory is kept in. A day is a local calendar date,
 * "YYYY-MM-DD", in the time zone of the computer Carrel runs on.
 */
export type Day = string

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function isDay(value: unknown): value is Day {
  return typeof value === 'string' && DAY.test(value)
}

/** The local day a moment falls on. */
export function dayOf(moment: Date | string | number): Day {
  const date = moment instanceof Date ? moment : new Date(moment)
  if (Number.isNaN(date.getTime())) throw new Error('That is not a moment in time.')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local midnight at the start of a day. */
export function startOf(day: Day): Date {
  if (!isDay(day)) throw new Error(`"${day}" is not a day.`)
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d)
}

/** The day `n` days after (or before, when negative) another. */
export function addDays(day: Day, n: number): Day {
  const start = startOf(day)
  return dayOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + n))
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((startOf(b).getTime() - startOf(a).getTime()) / 86_400_000)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct 15", as the map's cards and axis write a day. */
export function dayLabel(day: Day): string {
  const start = startOf(day)
  return `${MONTHS[start.getMonth()]} ${start.getDate()}`
}

/** "10:40", the local time of a moment. */
export function timeLabel(moment: string | Date): string {
  const date = moment instanceof Date ? moment : new Date(moment)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
