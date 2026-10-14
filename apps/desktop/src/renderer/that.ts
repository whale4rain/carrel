// *that.* on the desk: what the person is pointing at when they press ⌘.
import type { ThatRequest } from '../shared/workspace-api.js'

/**
 * Text in an element, as one string (a <br>, which ends a PDF line, counts as
 * a line break), with where a range starts and ends in it.
 */
export function textOffsets(root: Node, range: Range): { source: string; start: number; end: number } | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let source = ''
  let start = -1
  let end = -1
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof HTMLBRElement) source += '\n'
    if (!(node instanceof Text)) continue
    if (node === range.startContainer) start = source.length + range.startOffset
    if (node === range.endContainer) end = source.length + range.endOffset
    source += node.data
  }
  // A range that starts or ends on an element, not in text: find its words instead.
  if (start < 0 || end <= start) {
    const exact = range.toString()
    start = exact ? source.indexOf(exact) : -1
    end = start + exact.length
  }
  return start < 0 || end <= start ? undefined : { source, start, end }
}

/** Selected text in a PDF on the desk: its sheet, page and offsets in the page's text. */
export function pdfSelection(selection: Selection | null): { sheet: string; request: Omit<ThatRequest, 'itemId'> } | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined
  const range = selection.getRangeAt(0)
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const page = start?.closest<HTMLElement>('.pdf-page')
  const layer = page?.querySelector('.textLayer')
  const sheet = page?.closest<HTMLElement>('.sheet')?.dataset.sheet
  if (!page || !layer || !sheet) return undefined
  // A selection running past its page keeps only this page's part.
  const within = range.cloneRange()
  if (!layer.contains(range.endContainer)) within.setEnd(layer, layer.childNodes.length)
  const text = textOffsets(layer, within)
  return text && { sheet, request: { page: Number(page.dataset.page), text } }
}
