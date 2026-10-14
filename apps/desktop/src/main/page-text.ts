// The text of a web page as *that.* sees it: every text node under <body>,
// in order, leaving out scripts and styles. Runs inside the page.

/** Returns the page's selection as `{ source, start, end }`, or null when nothing is selected. */
export const SELECTION_IN_PAGE = `(() => {
  const selection = getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !document.body) return null
  const range = selection.getRangeAt(0)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement && node.parentElement.closest('script, style, noscript') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  let source = ''
  let start = -1
  let end = -1
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === range.startContainer) start = source.length + range.startOffset
    if (node === range.endContainer) end = source.length + range.endOffset
    source += node.data
  }
  // A selection that starts or ends on an element, not in text: find its words instead.
  if (start < 0 || end <= start) {
    const exact = selection.toString()
    start = exact ? source.indexOf(exact) : -1
    end = start + exact.length
  }
  return start < 0 || end <= start ? null : { source, start, end }
})()`
