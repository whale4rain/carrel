import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useEffect, useRef, useState, type RefObject } from 'react'

GlobalWorkerOptions.workerSrc = workerUrl

const api = window.carrel.workspace

/** Room around the pages inside the sheet, and the scroll bar's, in desk units. */
const MARGIN = 16
const SCROLLBAR = 10
const GAP = 12

/**
 * A stored PDF, read inside its sheet. Pages are laid out at the sheet's
 * width and only those near the view are drawn, at a resolution matched to
 * how big the sheet is on screen (`detail`: its scale times the desk zoom).
 * Each page has a text layer, so text can be selected.
 */
export function PdfView({ itemId, width, detail, onPage }: { itemId: string; width: number; detail: number; onPage?: (page: string) => void }) {
  const [pdf, setPdf] = useState<{ doc: PDFDocumentProxy; ratio: number }>()
  const [error, setError] = useState<string>()
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current = true
    let loaded: PDFDocumentProxy | undefined
    api
      .itemBytes(itemId)
      .then((data) => getDocument({ data }).promise)
      .then(async (doc) => {
        loaded = doc
        const first = await doc.getPage(1)
        const { width, height } = first.getViewport({ scale: 1 })
        if (current) setPdf({ doc, ratio: height / width })
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      current = false
      void loaded?.destroy()
    }
  }, [itemId])

  // The page nearest the top of the view, for the sheet's label.
  const pageWidth = width - MARGIN * 2 - SCROLLBAR
  useEffect(() => {
    const element = scroller.current
    if (!element || !pdf || !onPage) return
    const report = (): void => {
      const pageHeight = pageWidth * pdf.ratio + GAP
      const page = Math.min(pdf.doc.numPages, Math.floor((element.scrollTop + pageHeight / 3) / pageHeight) + 1)
      onPage(`p. ${page} / ${pdf.doc.numPages}`)
    }
    report()
    element.addEventListener('scroll', report, { passive: true })
    return () => element.removeEventListener('scroll', report)
  }, [pdf, pageWidth, onPage])

  if (error) return <p className="viewer-note">This PDF couldn't be opened: {error}</p>
  if (!pdf) return <p className="viewer-note">Opening…</p>
  return (
    <div className="pdf-view" ref={scroller} data-scrolls="">
      {Array.from({ length: pdf.doc.numPages }, (_, i) => (
        <PdfPage key={i} doc={pdf.doc} number={i + 1} width={pageWidth} height={pageWidth * pdf.ratio} detail={detail} root={scroller} />
      ))}
    </div>
  )
}

function PdfPage(props: {
  doc: PDFDocumentProxy
  number: number
  width: number
  height: number
  detail: number
  root: RefObject<HTMLDivElement | null>
}) {
  const { doc, number, width, height, detail, root } = props
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [page, setPage] = useState<PDFPageProxy>()

  // Draw only pages within a screen or so of the view.
  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setNear(entry?.isIntersecting ?? false), { root: root.current, rootMargin: '100% 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [root])

  useEffect(() => {
    if (!near || page) return
    let current = true
    void doc.getPage(number).then((loaded) => {
      if (current) setPage(loaded)
    })
    return () => {
      current = false
    }
  }, [doc, near, number, page])

  // Canvas pixels follow the on-screen size, rounded so small zoom changes don't redraw.
  const pixels = Math.min(3, Math.max(0.5, Math.ceil(detail * window.devicePixelRatio * 4) / 4))
  useEffect(() => {
    const target = canvas.current
    const layer = text.current
    if (!near || !page || !target || !layer) return
    const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width })
    target.width = Math.floor(viewport.width * pixels)
    target.height = Math.floor(viewport.height * pixels)
    const task = page.render({ canvas: target, viewport, transform: pixels === 1 ? undefined : [pixels, 0, 0, pixels, 0, 0] })
    layer.replaceChildren()
    layer.style.setProperty('--total-scale-factor', String(viewport.scale))
    const textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport })
    textLayer.render().catch(() => undefined)
    return () => {
      task.cancel()
      textLayer.cancel()
    }
  }, [near, page, pixels, width])

  return (
    <div className="pdf-page" ref={box} data-page={number} style={{ width, height }}>
      {near && (
        <>
          <canvas ref={canvas} style={{ width, height }} />
          <div className="textLayer" ref={text} />
        </>
      )}
    </div>
  )
}
