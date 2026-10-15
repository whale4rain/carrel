// *that.* on the desk: what the person is pointing at when they press ⌘.
import type { ThatRequest } from '../shared/workspace-api.js'

/**
 * Text in an element, as one string (a <br>, which ends a PDF line, counts as
 * a line break), with where each text node starts in it.
 */
export function textOf(root: Node): { source: string; nodes: Array<{ node: Text; offset: number }> } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let source = ''
  const nodes: Array<{ node: Text; offset: number }> = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof HTMLBRElement) source += '\n'
    if (!(node instanceof Text)) continue
    nodes.push({ node, offset: source.length })
    source += node.data
  }
  return { source, nodes }
}

/** A range over `[start, end)` of `textOf(root)`. */
export function rangeAt(text: ReturnType<typeof textOf>, start: number, end: number): Range | undefined {
  const at = (position: number): { node: Text; offset: number } | undefined => {
    for (const { node, offset } of text.nodes) if (position >= offset && position <= offset + node.data.length) return { node, offset: position - offset }
    return undefined
  }
  const from = at(start)
  const to = at(end)
  if (!from || !to) return undefined
  const range = document.createRange()
  range.setStart(from.node, from.offset)
  range.setEnd(to.node, to.offset)
  return range
}

/** Where a range starts and ends in the text of an element (see `textOf`). */
export function textOffsets(root: Node, range: Range): { source: string; start: number; end: number } | undefined {
  const { source, nodes } = textOf(root)
  let start = -1
  let end = -1
  for (const { node, offset } of nodes) {
    if (node === range.startContainer) start = offset + range.startOffset
    if (node === range.endContainer) end = offset + range.endOffset
  }
  // A range that starts or ends on an element, not in text: find its words instead.
  if (start < 0 || end <= start) {
    const exact = range.toString()
    start = exact ? source.indexOf(exact) : -1
    end = start + exact.length
  }
  return start < 0 || end <= start ? undefined : { source, start, end }
}

/** Selected text in a PDF or a document on the desk: its sheet, page (or section) and offsets in that page's text. */
export function pdfSelection(selection: Selection | null): { sheet: string; request: Omit<ThatRequest, 'itemId'> } | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined
  const range = selection.getRangeAt(0)
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const page = start?.closest<HTMLElement>('.pdf-page, .doc-section')
  const layer = page?.querySelector('.textLayer, .doc-text')
  const sheet = page?.closest<HTMLElement>('.sheet')?.dataset.sheet
  if (!page || !layer || !sheet) return undefined
  // A selection running past its page keeps only this page's part.
  const within = range.cloneRange()
  if (!layer.contains(range.endContainer)) within.setEnd(layer, layer.childNodes.length)
  const text = textOffsets(layer, within)
  return text && { sheet, request: { page: Number(page.dataset.page), text } }
}
