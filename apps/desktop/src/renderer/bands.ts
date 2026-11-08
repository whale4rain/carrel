// *that.* bands in the desk's sources: the pencil mark under the words, drawn
// with the CSS Custom Highlight API so the text layer itself is never changed.
// The margin reads the same ranges to start its lines at the words.

const bands = new Map<string, Range[]>()
let active: string | undefined
const listeners = new Set<() => void>()

/** The key for one *that.* on one sheet. */
export const bandKey = (sheet: string, that: string): string => `${sheet}/${that}`

/** The words just selected in the margin's open box, before they are kept. */
export const DRAFT_BAND = 'draft'

export function setBands(key: string, ranges: Range[]): void {
  if (ranges.length > 0) bands.set(key, ranges)
  else bands.delete(key)
  refresh()
}

/** Brightens one band, as when its chip was just opened. */
export function setActiveBand(key: string | undefined): void {
  active = key
  refresh()
}

/** Where a band is now, if its words are drawn. */
export function bandRanges(key: string): readonly Range[] {
  return bands.get(key) ?? []
}

/** Called whenever bands are placed or taken away (a page drew its text, a that. was made). */
export function onBands(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function refresh(): void {
  for (const listener of listeners) listener()
  if (typeof Highlight === 'undefined') return
  const all = new Highlight()
  const on = new Highlight()
  for (const [key, ranges] of bands) for (const range of ranges) (key === active ? on : all).add(range)
  CSS.highlights.set('that', all)
  CSS.highlights.set('that-active', on)
}
