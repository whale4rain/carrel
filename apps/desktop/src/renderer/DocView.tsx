import type { DocBlock, DocInline, ReadingDocument } from '@carrel/core/documents'
import { findText, pageOf } from '@carrel/core/selectors'
import { createElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ThatView } from '../shared/workspace-api.js'
import { bandKey, setActiveBand, setBands } from './bands.js'
import type { Focus } from './PdfView.js'
import { ReaderTools, type Bookmarks } from './ReaderTools.js'
import { rangeAt, textOf } from './that.js'

const api = window.carrel.workspace

/** The text's size at 100%, in desk units; zoom scales it and the text reflows. */
const TEXT_SIZE = 15

/** How long scrolling must pause before the reading position is saved. */
const SAVE_AFTER = 600

/**
 * A stored file read as text (Markdown, and later EPUB, Word, PowerPoint): its
 * sections one after another on a paper column, reflowed to the sheet's width.
 * A section stands where a PDF has a page, for the reading strip, *that.*s,
 * bookmarks and the place last read.
 */
export function DocView({
  sheet,
  itemId,
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
  /** The item's *that.*s, marked in their sections. */
  thats: readonly ThatView[]
  focus: Focus | undefined
  /** A section to scroll to (a search found it). */
  goTo?: { page: number; nonce: number } | undefined
  /** The text's zoom. */
  zoom: number
  onZoom: (how: 1 | -1 | 'fit') => void
  onPage?: (page: string) => void
  onFound: (that: string, found: boolean) => void
  bookmarks: Bookmarks
  keys: boolean
  onBookmark: (page: number, label: string | null) => void
}) {
  const [doc, setDoc] = useState<ReadingDocument>()
  const [error, setError] = useState<string>()
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let current = true
    api.document(itemId).then(
      (read) => current && setDoc(read),
      (reason: unknown) => current && setError(reason instanceof Error ? reason.message : String(reason)),
    )
    return () => {
      current = false
    }
  }, [itemId])

  const sectionsIn = (): HTMLElement[] => [...(scroller.current?.querySelectorAll<HTMLElement>('.doc-section') ?? [])]
  /** Where the view is: a section and how far down it. */
  const where = (): { page: number; offset: number } => {
    const element = scroller.current
    if (!element) return { page: 1, offset: 0 }
    const top = element.scrollTop + 1
    const all = sectionsIn()
    let index = 0
    for (let i = 0; i < all.length; i++) if (all[i]!.offsetTop <= top) index = i
    const section = all[index]
    const offset = section && section.offsetHeight > 0 ? Math.min(1, Math.max(0, (top - section.offsetTop) / section.offsetHeight)) : 0
    return { page: index + 1, offset }
  }
  const [page, setPage] = useState(1)
  const here = useRef({ page: 1, offset: 0 })
  /** A section gone to on purpose. Near the end it may not reach the top, but it is still the one you're on. */
  const jumped = useRef<{ page: number; top: number }>(undefined)

  // Back where it was last read, unless a that. or a section was asked for. Saved as you read.
  const restored = useRef(false)
  const saving = useRef<ReturnType<typeof setTimeout>>(undefined)
  const save = (): void => {
    if (!restored.current) return
    clearTimeout(saving.current)
    saving.current = setTimeout(() => void api.saveReadAt(itemId, here.current).catch(() => undefined), SAVE_AFTER)
  }
  useEffect(() => () => clearTimeout(saving.current), [])

  const scrollTo = (at: { page: number; offset: number }): void => {
    const element = scroller.current
    const section = sectionsIn()[Math.max(0, at.page - 1)]
    if (!element || !section) return
    element.scrollTop = section.offsetTop + at.offset * section.offsetHeight
    jumped.current = { page: at.page, top: element.scrollTop }
    here.current = at
    setPage(at.page)
    save()
  }

  useEffect(() => {
    if (!doc) return
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
  }, [doc])
  useEffect(() => {
    const element = scroller.current
    if (!element || !doc) return
    const onScroll = (): void => {
      if (!jumped.current || Math.abs(element.scrollTop - jumped.current.top) >= 2) {
        jumped.current = undefined
        here.current = where()
        setPage(here.current.page)
      }
      save()
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  })

  // Zooming reflows the text; the same spot stays in view.
  useLayoutEffect(() => {
    if (doc) scrollTo(here.current)
    // Only a change of size matters.
  }, [zoom])

  useEffect(() => {
    if (doc) onPage?.(`§ ${page} / ${doc.sections.length}`)
  }, [doc, page, onPage])

  // Opening a that.: go to its section; the section finds the words.
  useEffect(() => {
    if (!doc || !focus) return
    const at = pageOf(focus.that.selectors)
    if (at === undefined || at > doc.sections.length) {
      onFound(focus.that.id, false)
      return
    }
    scrollTo({ page: at, offset: 0 })
    // Only the newest request counts.
  }, [focus?.nonce, doc])

  useEffect(() => {
    if (doc && goTo) scrollTo({ page: goTo.page, offset: 0 })
  }, [goTo?.nonce, doc])

  if (error) return <p className="viewer-note">This file couldn't be read: {error}</p>
  if (!doc) return <p className="viewer-note">Opening…</p>
  const toggleBookmark = (): void => {
    const at = page
    if (bookmarks.some((bookmark) => bookmark.page === at)) onBookmark(at, null)
    else onBookmark(at, doc.sections[at - 1]?.title ?? `Section ${at}`)
  }
  return (
    <div className="pdf-reader">
      <ReaderTools
        unit="§"
        page={page}
        pages={doc.sections.length}
        onGo={(to) => scrollTo({ page: to, offset: 0 })}
        chapters={doc.sections.length > 1 ? doc.sections.map((section, i) => ({ title: section.title, page: i + 1, items: [] })) : 'none'}
        bookmarks={bookmarks}
        onBookmark={toggleBookmark}
        onUnmark={(at) => onBookmark(at, null)}
        keys={keys}
        zoom={zoom}
        onZoom={onZoom}
      />
      <div className="doc-view" ref={scroller} data-scrolls="" style={{ fontSize: TEXT_SIZE * zoom }}>
        <div className="doc-paper">
          {doc.sections.map((section, i) => (
            <DocSection
              key={i}
              sheet={sheet}
              number={i + 1}
              blocks={section.blocks}
              marked={bookmarks.some((bookmark) => bookmark.page === i + 1)}
              thats={thats}
              focus={focus && pageOf(focus.that.selectors) === i + 1 ? focus : undefined}
              onFound={onFound}
              root={scroller}
              zoom={zoom}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function DocSection(props: {
  sheet: string
  number: number
  blocks: readonly DocBlock[]
  marked: boolean
  thats: readonly ThatView[]
  focus: Focus | undefined
  onFound: (that: string, found: boolean) => void
  root: RefObject<HTMLDivElement | null>
  zoom: number
}) {
  const { sheet, number, blocks, marked, thats, focus, onFound, root, zoom } = props
  const text = useRef<HTMLDivElement>(null)
  const handled = useRef<number>(undefined)
  const mine = thats.filter((that) => pageOf(that.selectors) === number)

  // Bands under this section's that.s: exact position first, then the quote.
  useEffect(() => {
    const layer = text.current
    if (!layer) return
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
    // `mine` is rebuilt every render; its ids are what matter. Zoom moves the words.
  }, [sheet, mine.map((that) => that.id).join(), focus?.nonce, zoom])

  return (
    <section className="doc-section" data-page={number} data-bookmarked={marked || undefined}>
      {marked && <span className="pdf-ribbon" aria-hidden />}
      <div className="doc-text" ref={text}>
        {drawBlocks(blocks)}
      </div>
    </section>
  )
}

/**
 * Blocks as plain elements. Every line of text ends with a line break inside
 * its element, so the section's text matches what search and the agent read
 * (`sectionTexts` in @carrel/core).
 */
function drawBlocks(blocks: readonly DocBlock[]): ReactNode[] {
  return blocks.map((block, key) => {
    switch (block.type) {
      case 'heading':
        return createElement(`h${Math.min(6, block.level + 1)}`, { key, className: `doc-h${block.level}` }, ...drawInlines(block.text), '\n')
      case 'paragraph':
        return (
          <p key={key}>
            {drawInlines(block.text)}
            {'\n'}
          </p>
        )
      case 'code':
        return (
          <pre key={key}>
            <code>
              {block.text}
              {'\n'}
            </code>
          </pre>
        )
      case 'list': {
        const items = block.items.map((item, at) => <li key={at}>{drawBlocks(item)}</li>)
        return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
      }
      case 'quote':
        return <blockquote key={key}>{drawBlocks(block.blocks)}</blockquote>
      case 'table':
        return (
          <table key={key}>
            <tbody>
              {block.rows.map((row, at) => (
                <tr key={at}>
                  {row.map((cell, column) =>
                    at === 0 ? (
                      <th key={column}>
                        {drawInlines(cell)}
                        {'\n'}
                      </th>
                    ) : (
                      <td key={column}>
                        {drawInlines(cell)}
                        {'\n'}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )
      case 'rule':
        return <hr key={key} />
    }
  })
}

function drawInlines(inlines: readonly DocInline[]): ReactNode[] {
  return inlines.map((inline, key) => {
    let node: ReactNode = inline.text
    if (inline.code) node = <code>{node}</code>
    if (inline.italic) node = <em>{node}</em>
    if (inline.bold) node = <strong>{node}</strong>
    // A link shows where it goes; following it waits for a way to open the web from here.
    if (inline.href) node = <span className="doc-link" title={inline.href}>{node}</span>
    return <span key={key}>{node}</span>
  })
}
