import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { findText, pageOf, regionOf } from '@carrel/core/selectors'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ThatView } from '../shared/workspace-api.js'
import { bandKey, setActiveBand, setBands } from './bands.js'
import { rangeAt, textOf } from './that.js'

GlobalWorkerOptions.workerSrc = workerUrl

const api = window.carrel.workspace

/** Room around the pages inside the sheet, and the scroll bar's, in desk units. */
const MARGIN = 16
const SCROLLBAR = 10
const GAP = 12

/** A *that.* to open: scroll to it and brighten it. `nonce` lets the same one be opened again. */
export interface Focus {
  that: ThatView
  nonce: number
}

/**
 * A stored PDF, read inside its sheet. Pages are laid out at the sheet's
 * width and only those near the view are drawn, at a resolution matched to
 * how big the sheet is on screen (`detail`: its scale times the desk zoom).
 * Each page has a text layer, so text can be selected.
 */
export function PdfView({
  sheet,
  itemId,
  width,
  detail,
  thats,
  focus,
  goTo,
  onPage,
  onFound,
}: {
  sheet: string
  itemId: string
  width: number
  detail: number
  /** The item's *that.*s, marked on their pages. */
  thats: readonly ThatView[]
  focus: Focus | undefined
  /** A page to scroll to (a search found it). */
  goTo?: { page: number; nonce: number } | undefined
  onPage?: (page: string) => void
  /** Whether the focused *that.* was found where it pointed. */
  onFound: (that: string, found: boolean) => void
}) {
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

  // Opening a that.: go to its page; the page finds the words once its text is drawn.
  useEffect(() => {
    const element = scroller.current
    if (!element || !pdf || !focus) return
    const page = pageOf(focus.that.selectors)
    if (page === undefined || page > pdf.doc.numPages) {
      onFound(focus.that.id, false)
      return
    }
    element.scrollTop = (page - 1) * (pageWidth * pdf.ratio + GAP)
    // Only the newest request counts.
  }, [focus?.nonce, pdf])

  // A page asked for: its top at the top of the view.
  useEffect(() => {
    const element = scroller.current
    if (!element || !pdf || !goTo) return
    element.scrollTop = (Math.min(goTo.page, pdf.doc.numPages) - 1) * (pageWidth * pdf.ratio + GAP)
  }, [goTo?.nonce, pdf])

  if (error) return <p className="viewer-note">This PDF couldn't be opened: {error}</p>
  if (!pdf) return <p className="viewer-note">Opening…</p>
  return (
    <div className="pdf-view" ref={scroller} data-scrolls="">
      {Array.from({ length: pdf.doc.numPages }, (_, i) => (
        <PdfPage
          key={i}
          sheet={sheet}
          doc={pdf.doc}
          number={i + 1}
          width={pageWidth}
          height={pageWidth * pdf.ratio}
          detail={detail}
          root={scroller}
          thats={thats}
          focus={focus && pageOf(focus.that.selectors) === i + 1 ? focus : undefined}
          onFound={onFound}
        />
      ))}
    </div>
  )
}

function PdfPage(props: {
  sheet: string
  thats: readonly ThatView[]
  focus: Focus | undefined
  onFound: (that: string, found: boolean) => void
  doc: PDFDocumentProxy
  number: number
  width: number
  height: number
  detail: number
  root: RefObject<HTMLDivElement | null>
}) {
  const { sheet, thats, focus, onFound, doc, number, width, height, detail, root } = props
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [page, setPage] = useState<PDFPageProxy>()
  // Counts text layers drawn, so bands are placed again on the new one.
  const [drawn, setDrawn] = useState(0)

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
    textLayer.render().then(() => setDrawn((count) => count + 1), () => undefined)
    return () => {
      task.cancel()
      textLayer.cancel()
    }
  }, [near, page, pixels, width])

  // Bands under this page's that.s: exact position first, then the quote.
  const mine = thats.filter((that) => pageOf(that.selectors) === number && regionOf(that.selectors) === undefined)
  const boxes = thats.flatMap((that) => {
    const region = pageOf(that.selectors) === number ? regionOf(that.selectors) : undefined
    return region ? [{ that, region }] : []
  })
  const handled = useRef<number>(undefined)
  const [activeBox, setActiveBox] = useState<string>()

  // A region that. is a box on its page: opening it scrolls the box into view.
  useEffect(() => {
    const entry = focus && boxes.find((candidate) => candidate.that.id === focus.that.id)
    const element = entry && box.current?.querySelector<HTMLElement>(`[data-that="${entry.that.id}"]`)
    const scroller = root.current
    if (!focus || !entry || !element || !scroller || handled.current === focus.nonce) return
    handled.current = focus.nonce
    const view = scroller.getBoundingClientRect()
    const factor = view.height / scroller.clientHeight || 1
    scroller.scrollTop += (element.getBoundingClientRect().top - view.top - view.height / 3) / factor
    setActiveBox(entry.that.id)
    setActiveBand(undefined)
    onFound(entry.that.id, true)
    // Runs when a newly opened region's page comes near.
  }, [focus?.nonce, near])
  useEffect(() => {
    const layer = text.current
    if (!layer || drawn === 0) return
    const content = textOf(layer)
    const placed = new Map<string, Range>()
    for (const that of mine) {
      const found = findText(content.source, that.selectors)
      const range = found && rangeAt(content, found.start, found.end)
      if (range) placed.set(that.id, range)
      setBands(bandKey(sheet, that.id), range ? [range] : [])
    }
    if (focus && handled.current !== focus.nonce) {
      handled.current = focus.nonce
      const range = placed.get(focus.that.id)
      if (regionOf(focus.that.selectors)) return
      setActiveBox(undefined)
      onFound(focus.that.id, range !== undefined)
      const scroller = root.current
      if (range && scroller) {
        // Bring the band a third of the way down the view; screen pixels are scaled with the sheet.
        const view = scroller.getBoundingClientRect()
        const factor = view.height / scroller.clientHeight || 1
        scroller.scrollTop += (range.getBoundingClientRect().top - view.top - view.height / 3) / factor
        setActiveBand(bandKey(sheet, focus.that.id))
      }
    }
    return () => {
      for (const that of mine) setBands(bandKey(sheet, that.id), [])
    }
    // `mine` is rebuilt every render; its ids are what matter.
  }, [drawn, sheet, mine.map((that) => that.id).join(), focus?.nonce])

  return (
    <div className="pdf-page" ref={box} data-page={number} style={{ width, height }}>
      {near && (
        <>
          <canvas ref={canvas} style={{ width, height }} />
          <div className="textLayer" ref={text} />
        </>
      )}
      {boxes.map(({ that, region }) => (
        <div
          key={that.id}
          className="that-box"
          data-that={that.id}
          data-active={activeBox === that.id || undefined}
          style={{ left: `${region.x}%`, top: `${region.y}%`, width: `${region.w}%`, height: `${region.h}%` }}
        />
      ))}
    </div>
  )
}
