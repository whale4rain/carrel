// *that.* bands in the desk's sources: the highlighter under the words, drawn
// with the CSS Custom Highlight API so the text layer itself is never changed.

const bands = new Map<string, Range[]>()
let active: string | undefined

/** The key for one *that.* on one sheet. */
export const bandKey = (sheet: string, that: string): string => `${sheet}/${that}`

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

function refresh(): void {
  if (typeof Highlight === 'undefined') return
  const all = new Highlight()
  const on = new Highlight()
  for (const [key, ranges] of bands) for (const range of ranges) (key === active ? on : all).add(range)
  CSS.highlights.set('that', all)
  CSS.highlights.set('that-active', on)
}
