// The text of a web page as *that.* sees it: every text node under <body>,
// in order, leaving out scripts and styles. These scripts run inside the page.

/** Defines `walk(visit)`, calling `visit(node, offset)` for each text node with where it starts. */
const WALK = `
  const walk = (visit) => {
    if (!document.body) return ''
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.parentElement && node.parentElement.closest('script, style, noscript') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    let source = ''
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      visit(node, source.length)
      source += node.data
    }
    return source
  }`

/** Returns the page's selection as `{ source, start, end }`, or null when nothing is selected. */
export const SELECTION_IN_PAGE = `(() => {${WALK}
  const selection = getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  let start = -1
  let end = -1
  const source = walk((node, offset) => {
    if (node === range.startContainer) start = offset + range.startOffset
    if (node === range.endContainer) end = offset + range.endOffset
  })
  // A selection that starts or ends on an element, not in text: find its words instead.
  if (start < 0 || end <= start) {
    const exact = selection.toString()
    start = exact ? source.indexOf(exact) : -1
    end = start + exact.length
  }
  return start < 0 || end <= start ? null : { source, start, end }
})()`

/** Returns the page's text. */
export const TEXT_OF_PAGE = `(() => {${WALK}
  return walk(() => undefined)
})()`

/** How *that.* bands look in a page; the page's own styles can't reach these names. */
export const BAND_STYLE = `
  ::highlight(carrel-that) { background-color: rgb(255 225 77 / 0.45); color: inherit; }
  ::highlight(carrel-that-active) { background-color: rgb(255 225 77 / 0.85); color: inherit; }`

/** Marks each band's words, and scrolls the focused one into view. */
export function bandsInPage(bands: ReadonlyArray<{ id: string; start: number; end: number }>, focus: string | undefined): string {
  return `(() => {${WALK}
  const bands = ${JSON.stringify(bands)}
  const focus = ${JSON.stringify(focus ?? null)}
  const nodes = []
  walk((node, offset) => nodes.push({ node, offset }))
  const at = (position) => {
    for (const { node, offset } of nodes) if (position <= offset + node.data.length) return { node, offset: position - offset }
    return undefined
  }
  if (typeof Highlight === 'undefined' || !CSS.highlights) return
  const all = new Highlight()
  const active = new Highlight()
  for (const band of bands) {
    const start = at(band.start)
    const end = at(band.end)
    if (!start || !end) continue
    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    ;(band.id === focus ? active : all).add(range)
    if (band.id === focus) start.node.parentElement?.scrollIntoView({ block: 'center' })
  }
  CSS.highlights.set('carrel-that', all)
  CSS.highlights.set('carrel-that-active', active)
})()`
}
