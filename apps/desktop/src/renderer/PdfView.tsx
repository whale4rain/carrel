import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { findText, pageOf, regionOf } from '@carrel/core/selectors'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ThatView } from '../shared/workspace-api.js'
import { bandKey, setActiveBand, setBands } from './bands.js'
import { rangeAt, textOf } from './that.js'
import { ReaderTools, type Bookmarks, type Chapter } from './ReaderTools.js'

GlobalWorkerOptions.workerSrc = workerUrl

const api = window.carrel.workspace

/** Room around the pages inside the sheet, and the scroll bar's, in desk units. */
const MARGIN = 16
const SCROLLBAR = 10
const GAP = 12

/** How long scrolling must pause before the reading position is saved. */
const SAVE_AFTER = 600

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
  zoom,
  onZoom,
  onPage,
  onFound,
  bookmarks,
  keys,
  onBookmark,
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
  /** The pages' zoom: 1 fits the sheet's width. */
  zoom: number
  onZoom: (how: 1 | -1 | 'fit') => void
  onPage?: (page: string) => void
  /** Whether the focused *that.* was found where it pointed. */
  onFound: (that: string, found: boolean) => void
  /** Pages kept to come back to. */
  bookmarks: Bookmarks
  /** Whether the reader's own keys work now: its sheet is focused, or the only one selected. */
  keys: boolean
  /** Keep a page as a bookmark, with a few words to know it by, or let it go (null). */
  onBookmark: (page: number, label: string | null) => void
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
  const pageWidth = (width - MARGIN * 2 - SCROLLBAR) * zoom
  const step = pdf ? pageWidth * pdf.ratio + GAP : 0
  const [page, setPage] = useState(1)
  /** Where the view is: a page and how far down it. */
  const where = (): { page: number; offset: number } => {
    const element = scroller.current
    if (!element || !pdf || step === 0) return { page: 1, offset: 0 }
    // A pixel of slack: scrollTop is rounded.
    const at = Math.max(0, element.scrollTop - MARGIN + 1) / step
    const index = Math.min(pdf.doc.numPages - 1, Math.floor(at))
    return { page: index + 1, offset: Math.min(1, at - index) }
  }
  const scrollTo = (at: { page: number; offset: number }): void => {
    const element = scroller.current
    if (!element || !pdf) return
    element.scrollTop = (Math.min(Math.max(1, at.page), pdf.doc.numPages) - 1 + at.offset) * step + (at.page > 1 || at.offset > 0 ? MARGIN : 0)
  }

  // Back where it was last read, unless a that. or a page was asked for. Saved as you read.
  const restored = useRef(false)
  useEffect(() => {
    if (!pdf) return
    restored.current = false
    let current = true
    if (focus || goTo) {
      restored.current = true
      return
    }
    void api.readAt(itemId).then(
      (at) => {
        if (!current) return
        if (at) scrollTo(at)
        restored.current = true
      },
      () => (restored.current = true),
    )
    return () => {
      current = false
    }
    // Once per document.
  }, [pdf])
  useEffect(() => {
    const element = scroller.current
    if (!element || !pdf) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = (): void => {
      setPage(where().page)
      if (!restored.current) return
      clearTimeout(timer)
      timer = setTimeout(() => void api.saveReadAt(itemId, where()).catch(() => undefined), SAVE_AFTER)
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      element.removeEventListener('scroll', onScroll)
    }
  })

  // Zooming keeps the same spot in view.
  const lastStep = useRef(step)
  useLayoutEffect(() => {
    const element = scroller.current
    const before = lastStep.current
    lastStep.current = step
    if (!element || before === 0 || step === 0 || before === step) return
    const at = Math.max(0, element.scrollTop - MARGIN) / before
    element.scrollTop = at * step + MARGIN
    // Only a change of size matters.
  }, [step])

  const [contents, setContents] = useState<Chapter[] | 'none'>()
  const readContents = (): void => {
    if (contents || !pdf) return
    void chaptersOf(pdf.doc).then((found) => setContents(found.length > 0 ? found : 'none'), () => setContents('none'))
  }
  useEffect(() => {
    if (pdf) onPage?.(`p. ${page} / ${pdf.doc.numPages}`)
  }, [pdf, page, onPage])

  // Opening a that.: go to its page; the page finds the words once its text is drawn.
  useEffect(() => {
    const element = scroller.current
    if (!element || !pdf || !focus) return
    const page = pageOf(focus.that.selectors)
    if (page === undefined || page > pdf.doc.numPages) {
      onFound(focus.that.id, false)
      return
    }
    scrollTo({ page, offset: 0 })
    // Only the newest request counts.
  }, [focus?.nonce, pdf])

  // A page asked for: its top at the top of the view.
  useEffect(() => {
    const element = scroller.current
    if (!element || !pdf || !goTo) return
    scrollTo({ page: goTo.page, offset: 0 })
  }, [goTo?.nonce, pdf])

  // A bookmark keeps the page you're reading, known by its first words.
  const toggleBookmark = (): void => {
    if (!pdf) return
    const at = page
    if (bookmarks.some((bookmark) => bookmark.page === at)) onBookmark(at, null)
    else void firstWords(pdf.doc, at).then((words) => onBookmark(at, words))
  }

  if (error) return <p className="viewer-note">This PDF couldn't be opened: {error}</p>
  if (!pdf) return <p className="viewer-note">Opening…</p>
  return (
    <div className="pdf-reader">
      <ReaderTools
        unit="p."
        page={page}
        pages={pdf.doc.numPages}
        onGo={(to) => scrollTo({ page: to, offset: 0 })}
        chapters={contents}
        onContents={readContents}
        bookmarks={bookmarks}
        onBookmark={toggleBookmark}
        onUnmark={(at) => onBookmark(at, null)}
        keys={keys}
        zoom={zoom}
        onZoom={onZoom}
      />
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
          marked={bookmarks.some((bookmark) => bookmark.page === i + 1)}
        />
      ))}
      </div>
    </div>
  )
}

/** A page's first few words, to know its bookmark by. */
async function firstWords(doc: PDFDocumentProxy, number: number): Promise<string> {
  try {
    const content = await (await doc.getPage(number)).getTextContent()
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim()
    const words = text.split(' ').slice(0, 8).join(' ')
    return words.length > 0 ? (words.length < text.length ? `${words}…` : words) : `Page ${number}`
  } catch {
    return `Page ${number}`
  }
}

/** The PDF's outline, each entry with the page it points to. */
async function chaptersOf(doc: PDFDocumentProxy): Promise<Chapter[]> {
  const outline = (await doc.getOutline()) ?? []
  const pageOfDest = async (dest: unknown): Promise<number | undefined> => {
    try {
      const resolved = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(resolved)) return undefined
      const target: unknown = resolved[0]
      if (typeof target === 'number') return target + 1
      if (target && typeof target === 'object') return (await doc.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1
    } catch {
      return undefined
    }
    return undefined
  }
  const walk = async (entries: readonly { title: string; dest: unknown; items: readonly unknown[] }[]): Promise<Chapter[]> =>
    Promise.all(
      entries.map(async (entry) => ({
        title: entry.title,
        page: await pageOfDest(entry.dest),
        items: await walk(entry.items as typeof entries),
      })),
    )
  return walk(outline)
}

function PdfPage(props: {
  sheet: string
  /** A bookmark is kept on this page. */
  marked: boolean
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
  const { sheet, thats, focus, onFound, doc, number, width, height, detail, root, marked } = props
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
    <div className="pdf-page" ref={box} data-page={number} data-bookmarked={marked || undefined} style={{ width, height }}>
      {marked && <span className="pdf-ribbon" aria-hidden />}
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
