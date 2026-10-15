// *that.* selectors, after the W3C Web Annotation model. Plain functions, so
// the main process, the agent's tools and tests share them.

/** Words around a quote, kept to find it again if the text moves. */
export const CONTEXT = 32

export interface TextQuoteSelector {
  type: 'TextQuoteSelector'
  exact: string
  prefix: string
  suffix: string
}

/** Character offsets into the source's text (for a PDF, the page's text). */
export interface TextPositionSelector {
  type: 'TextPositionSelector'
  start: number
  end: number
}

/**
 * A PDF page (`page=3`, RFC 3778), a media moment or range (`t=754.3`, Media
 * Fragments), or a turn in one of the agent's threads (`turn=<id>`).
 */
export interface FragmentSelector {
  type: 'FragmentSelector'
  conformsTo: typeof PDF_FRAGMENT | typeof MEDIA_FRAGMENT | typeof TURN_FRAGMENT
  value: string
}

export type Selector = TextQuoteSelector | TextPositionSelector | FragmentSelector

export const PDF_FRAGMENT = 'http://tools.ietf.org/rfc/rfc3778'
export const MEDIA_FRAGMENT = 'http://www.w3.org/TR/media-frags/'
/** Carrel's own fragment: a turn in a thread. */
export const TURN_FRAGMENT = 'https://carrel.app/ns/turn'

/** What a *that.* on a turn points into: the thread, in place of an item. */
export const threadItem = (thread: string): string => `thread:${thread}`

/** The thread a *that.*'s item id names, if it is one. */
export function threadOf(itemId: string): string | undefined {
  return itemId.startsWith('thread:') ? itemId.slice('thread:'.length) : undefined
}

/** A turn of a thread, for a *that.* on something the agent said. */
export function turnSelector(turn: string): FragmentSelector {
  if (!/^[\w-]+$/.test(turn)) throw new Error('That is not a turn.')
  return { type: 'FragmentSelector', conformsTo: TURN_FRAGMENT, value: `turn=${turn}` }
}

/** The turn a selector list points at, if any. */
export function turnOf(selectors: readonly Selector[]): string | undefined {
  const fragment = selectors.find((selector) => selector.type === 'FragmentSelector' && selector.conformsTo === TURN_FRAGMENT)
  return fragment?.type === 'FragmentSelector' ? /^turn=([\w-]+)$/.exec(fragment.value)?.[1] : undefined
}

/** Selectors for `text.slice(start, end)`: the quote with its context, and where it is. */
export function textSelectors(text: string, start: number, end: number): [TextQuoteSelector, TextPositionSelector] {
  if (!(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= text.length)) {
    throw new Error('That selection is not in the text.')
  }
  return [
    { type: 'TextQuoteSelector', exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - CONTEXT), start), suffix: text.slice(end, end + CONTEXT) },
    { type: 'TextPositionSelector', start, end },
  ]
}

export function pageSelector(page: number): FragmentSelector {
  if (!Number.isInteger(page) || page < 1) throw new Error('That is not a page.')
  return { type: 'FragmentSelector', conformsTo: PDF_FRAGMENT, value: `page=${page}` }
}

/** One decimal place is plenty for pointing at a moment. */
export function momentSelector(seconds: number): FragmentSelector {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('That is not a moment.')
  return { type: 'FragmentSelector', conformsTo: MEDIA_FRAGMENT, value: `t=${Math.round(seconds * 10) / 10}` }
}

/** A box, in percent of the page or picture it sits on (Media Fragments `xywh=percent:`). */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export function regionSelector(region: Region): FragmentSelector {
  const { x, y, w, h } = region
  const fits = [x, y, w, h].every((n) => Number.isFinite(n) && n >= 0 && n <= 100) && w > 0 && h > 0 && x + w <= 100.001 && y + h <= 100.001
  if (!fits) throw new Error('That is not a region.')
  const round = (n: number): number => Math.round(n * 100) / 100
  return { type: 'FragmentSelector', conformsTo: MEDIA_FRAGMENT, value: `xywh=percent:${round(x)},${round(y)},${round(w)},${round(h)}` }
}

/** The region a selector list points at, if any. */
export function regionOf(selectors: readonly Selector[]): Region | undefined {
  for (const selector of selectors) {
    if (selector.type !== 'FragmentSelector') continue
    const parts = /^xywh=percent:([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/.exec(selector.value)
    if (parts) return { x: Number(parts[1]), y: Number(parts[2]), w: Number(parts[3]), h: Number(parts[4]) }
  }
  return undefined
}

/** The page a selector list points at, if any. */
export function pageOf(selectors: readonly Selector[]): number | undefined {
  const fragment = selectors.find((selector) => selector.type === 'FragmentSelector' && selector.conformsTo === PDF_FRAGMENT)
  const page = fragment?.type === 'FragmentSelector' ? /^page=(\d+)$/.exec(fragment.value)?.[1] : undefined
  return page === undefined ? undefined : Number(page)
}

/** The moment a selector list points at, in seconds, if any. */
export function momentOf(selectors: readonly Selector[]): number | undefined {
  const fragment = selectors.find((selector) => selector.type === 'FragmentSelector' && selector.conformsTo === MEDIA_FRAGMENT && selector.value.startsWith('t='))
  const at = fragment?.type === 'FragmentSelector' ? /^t=([\d.]+)/.exec(fragment.value)?.[1] : undefined
  return at === undefined ? undefined : Number(at)
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatMoment(seconds: number): string {
  const whole = Math.floor(Math.max(0, seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = String(whole % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** How a chip names its spot: "p.42", "12:34", or nothing for a web page. */
export function positionLabel(selectors: readonly Selector[]): string {
  const page = pageOf(selectors)
  if (page !== undefined) return `p.${page}`
  const moment = momentOf(selectors)
  if (moment !== undefined) return formatMoment(moment)
  if (turnOf(selectors) !== undefined) return 'turn'
  return ''
}

export type Found = { start: number; end: number; how: 'position' | 'quote' }

/**
 * Finds a *that.* in the text as it is now: at its exact position if the
 * quote is still there, else wherever the quote appears, preferring the
 * place whose context matches best and that is nearest the old position.
 * Undefined when the quote is gone; the snapshot is all that's left.
 */
export function findText(text: string, selectors: readonly Selector[]): Found | undefined {
  const quote = selectors.find((selector): selector is TextQuoteSelector => selector.type === 'TextQuoteSelector')
  const position = selectors.find((selector): selector is TextPositionSelector => selector.type === 'TextPositionSelector')
  if (!quote || quote.exact.length === 0) {
    return position && position.end <= text.length ? { start: position.start, end: position.end, how: 'position' } : undefined
  }
  if (position && text.slice(position.start, position.end) === quote.exact) return { start: position.start, end: position.end, how: 'position' }
  let best: { start: number; score: number } | undefined
  for (let at = text.indexOf(quote.exact); at !== -1; at = text.indexOf(quote.exact, at + 1)) {
    const before = common(text.slice(Math.max(0, at - quote.prefix.length), at), quote.prefix, true)
    const after = common(text.slice(at + quote.exact.length, at + quote.exact.length + quote.suffix.length), quote.suffix, false)
    const distance = position ? Math.abs(at - position.start) / Math.max(1, text.length) : 0
    const score = before + after - distance
    if (!best || score > best.score) best = { start: at, score }
  }
  return best && { start: best.start, end: best.start + quote.exact.length, how: 'quote' }
}

/** Characters two strings share at their ends (`fromEnd`) or starts. */
function common(a: string, b: string, fromEnd: boolean): number {
  let n = 0
  while (n < a.length && n < b.length && (fromEnd ? a[a.length - 1 - n] === b[b.length - 1 - n] : a[n] === b[n])) n++
  return n
}

export function isSelector(value: unknown): value is Selector {
  if (typeof value !== 'object' || value === null) return false
  const selector = value as Record<string, unknown>
  switch (selector.type) {
    case 'TextQuoteSelector':
      return typeof selector.exact === 'string' && typeof selector.prefix === 'string' && typeof selector.suffix === 'string'
    case 'TextPositionSelector':
      return Number.isInteger(selector.start) && Number.isInteger(selector.end)
    case 'FragmentSelector':
      return (selector.conformsTo === PDF_FRAGMENT || selector.conformsTo === MEDIA_FRAGMENT || selector.conformsTo === TURN_FRAGMENT) && typeof selector.value === 'string'
    default:
      return false
  }
}
