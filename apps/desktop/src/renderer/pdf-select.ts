// Dragging a selection across a PDF page, as pdf.js's own viewer does it.
//
// pdf.js's TextLayer only draws the words. Between them is empty layer, and a
// drag that passes over a gap (the space after a short line, a formula) makes
// Chromium extend the selection to the end of the page. pdf.js's viewer keeps
// an `.endOfContent` block right after the word the selection ends on, so the
// gaps belong to it and the selection stays where the pointer is.

const layers = new Map<HTMLElement, HTMLElement>()
let listening = false

function reset(end: HTMLElement, layer: HTMLElement): void {
  layer.append(end)
  end.style.width = ''
  end.style.height = ''
  end.style.userSelect = ''
  layer.classList.remove('selecting')
}

function listen(): void {
  if (listening) return
  listening = true
  let down = false
  let previous: Range | undefined
  document.addEventListener('pointerdown', () => {
    down = true
  })
  document.addEventListener('pointerup', () => {
    down = false
    layers.forEach(reset)
  })
  window.addEventListener('blur', () => {
    down = false
    layers.forEach(reset)
  })
  document.addEventListener('keyup', () => {
    if (!down) layers.forEach(reset)
  })
  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0) {
      layers.forEach(reset)
      return
    }
    const range = selection.getRangeAt(0)
    for (const [layer, end] of layers) {
      if (range.intersectsNode(layer)) layer.classList.add('selecting')
      else reset(end, layer)
    }
    // Put the block right after the end being dragged (or before the start, when dragging backwards).
    const backwards =
      previous !== undefined &&
      (range.compareBoundaryPoints(Range.END_TO_END, previous) === 0 || range.compareBoundaryPoints(Range.START_TO_END, previous) === 0)
    let anchor: Node | null = backwards ? range.startContainer : range.endContainer
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
    if (!backwards && range.endOffset === 0 && anchor) {
      do {
        while (anchor && !anchor.previousSibling) anchor = anchor.parentNode
        anchor = anchor?.previousSibling ?? null
      } while (anchor && !anchor.childNodes.length)
    }
    previous = range.cloneRange()
    const layer = anchor?.parentElement?.closest<HTMLElement>('.textLayer')
    const end = layer ? layers.get(layer) : undefined
    if (!anchor?.parentElement || !layer || !end) return
    end.style.width = layer.style.width
    end.style.height = layer.style.height
    end.style.userSelect = 'text'
    anchor.parentElement.insertBefore(end, backwards ? anchor : anchor.nextSibling)
  })
}

/** Call once a page's TextLayer has drawn its words; the returned function forgets the layer. */
export function keepSelectionInPlace(layer: HTMLElement): () => void {
  const end = document.createElement('div')
  end.className = 'endOfContent'
  layer.append(end)
  const press = (): void => layer.classList.add('selecting')
  layer.addEventListener('mousedown', press)
  layers.set(layer, end)
  listen()
  return () => {
    layer.removeEventListener('mousedown', press)
    layers.delete(layer)
    end.remove()
  }
}
