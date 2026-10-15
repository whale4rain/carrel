import { useEffect, useRef, useState } from 'react'
import { shortcutLabel, withShortcut } from '../shared/shortcuts.js'
import { BookmarkIcon } from './icons.js'
import { frame } from './platform.js'

/** One entry of a source's contents, with the page (or section) it starts on. */
export interface Chapter {
  title: string
  page: number | undefined
  items: Chapter[]
}

export type Bookmarks = ReadonlyArray<{ page: number; label: string }>

/**
 * The reading strip over a book, a paper or a document read as text:
 * Contents (bookmarks, then chapters), the page or section you're on (type
 * one to go there), the bookmark ribbon (⌘D / Ctrl+D), and zoom.
 */
export function ReaderTools({
  unit,
  page,
  pages,
  onGo,
  chapters,
  onContents,
  bookmarks,
  onBookmark,
  onUnmark,
  keys,
  zoom,
  onZoom,
}: {
  /** What a page is called here: "p." in a PDF, "§" in a document. */
  unit: string
  page: number
  pages: number
  onGo: (page: number) => void
  /** The contents, once read: undefined while reading, 'none' when there are none. */
  chapters: Chapter[] | 'none' | undefined
  /** Contents was opened (the contents may be read now). */
  onContents?: () => void
  bookmarks: Bookmarks
  /** The ribbon: keep this page, or let its bookmark go. */
  onBookmark: () => void
  onUnmark: (page: number) => void
  /** Whether ⌘D works now: the sheet is focused, or the only one selected. */
  keys: boolean
  zoom: number
  onZoom: (how: 1 | -1 | 'fit') => void
}) {
  const [typing, setTyping] = useState<string>()
  const [open, setOpen] = useState(false)
  const marked = bookmarks.some((bookmark) => bookmark.page === page)
  const name = unit === 'p.' ? 'page' : 'section'

  const toggle = useRef(onBookmark)
  toggle.current = onBookmark
  useEffect(() => {
    if (!keys) return
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'd') return
      if ((event.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      toggle.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keys])

  const go = (to: number): void => {
    setOpen(false)
    onGo(to)
  }
  const jump = (): void => {
    const wanted = Number(typing)
    setTyping(undefined)
    if (Number.isFinite(wanted) && wanted >= 1) onGo(Math.min(pages, Math.round(wanted)))
  }

  return (
    <div className="pdf-tools" role="toolbar" aria-label="Reading" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((now) => !now)
          onContents?.()
        }}
      >
        Contents
      </button>
      <label className="pdf-jump">
        <span>{unit}</span>
        <input
          aria-label={`Go to ${name}`}
          inputMode="numeric"
          value={typing ?? String(page)}
          onFocus={(event) => {
            setTyping(String(page))
            event.target.select()
          }}
          onChange={(event) => setTyping(event.target.value.replace(/\D/g, ''))}
          onBlur={() => setTyping(undefined)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              jump()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') event.currentTarget.blur()
          }}
        />
        <span>/ {pages}</span>
      </label>
      <button
        type="button"
        className="pdf-bookmark"
        aria-label={marked ? `Remove the bookmark on ${name} ${page}` : `Bookmark ${name} ${page}`}
        aria-pressed={marked}
        title={withShortcut(frame, marked ? `Remove this ${name}’s bookmark` : `Bookmark this ${name}`, 'bookmark')}
        onClick={onBookmark}
      >
        <BookmarkIcon filled={marked} />
      </button>
      <span className="grow" />
      <button type="button" aria-label={`Zoom ${name}s out`} title="Zoom out" onClick={() => onZoom(-1)}>
        −
      </button>
      <button type="button" className="position" aria-label={`${name === 'page' ? 'Pages' : 'Text'} zoom`} title="Back to 100%" onClick={() => onZoom('fit')}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label={`Zoom ${name}s in`} title="Zoom in" onClick={() => onZoom(1)}>
        +
      </button>
      {open && (
        <nav className="pdf-contents" aria-label="Contents">
          <h4>Bookmarks</h4>
          {bookmarks.length === 0 ? (
            <p>
              No bookmarks yet. The ribbon, or {shortcutLabel(frame, 'bookmark')}, keeps the {name} you’re reading.
            </p>
          ) : (
            <ul aria-label="Bookmarks">
              {bookmarks.map((bookmark) => (
                <li key={bookmark.page} className="pdf-bookmark-row">
                  <button type="button" onClick={() => go(bookmark.page)}>
                    <span className="grow">{bookmark.label}</span>
                    <span className="position">{bookmark.page}</span>
                  </button>
                  <button type="button" className="pdf-unmark" aria-label={`Remove the bookmark on ${name} ${bookmark.page}`} onClick={() => onUnmark(bookmark.page)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h4>Chapters</h4>
          {chapters === undefined ? (
            <p>Reading the contents…</p>
          ) : chapters === 'none' ? (
            <p>This {unit === 'p.' ? 'PDF' : 'file'} has no contents list. Type a {name} number to jump.</p>
          ) : (
            <ChapterList chapters={chapters} onOpen={go} />
          )}
        </nav>
      )}
    </div>
  )
}

function ChapterList({ chapters, onOpen }: { chapters: Chapter[]; onOpen: (page: number) => void }) {
  return (
    <ul>
      {chapters.map((chapter, i) => (
        <li key={i}>
          <button type="button" disabled={chapter.page === undefined} onClick={() => chapter.page !== undefined && onOpen(chapter.page)}>
            <span className="grow">{chapter.title}</span>
            {chapter.page !== undefined && <span className="position">{chapter.page}</span>}
          </button>
          {chapter.items.length > 0 && <ChapterList chapters={chapter.items} onOpen={onOpen} />}
        </li>
      ))}
    </ul>
  )
}
