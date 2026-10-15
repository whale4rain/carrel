import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ItemView, SearchHitView } from '../shared/workspace-api.js'
import { BookIcon, LinkIcon, NoteIcon, SearchIcon } from './icons.js'

const api = window.carrel.workspace

/** Waits this long after typing stops before searching. */
const SEARCH_AFTER = 120

/**
 * Search everything (⌘K / Ctrl+K): the open project's notes, sources,
 * *that.*s and PDF pages. Arrows move, Enter opens, Esc closes.
 */
export function SearchPalette({
  items,
  onOpen,
  onClose,
}: {
  items: ReadonlyMap<string, ItemView>
  onOpen: (hit: SearchHitView) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHitView[]>([])
  const [searched, setSearched] = useState('')
  const [chosen, setChosen] = useState(0)
  const [error, setError] = useState<string>()
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let current = true
    const timer = window.setTimeout(() => {
      api.search(query).then(
        (found) => {
          if (!current) return
          setHits(found)
          setSearched(query)
          setChosen(0)
          setError(undefined)
        },
        (reason: unknown) => {
          if (current) setError(reason instanceof Error ? reason.message : String(reason))
        },
      )
    }, SEARCH_AFTER)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    list.current?.querySelector('[data-chosen]')?.scrollIntoView({ block: 'nearest' })
  }, [chosen])

  const open = (hit: SearchHitView | undefined): void => {
    if (!hit) return
    onOpen(hit)
    onClose()
  }

  return (
    <div className="search-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="search-palette" role="dialog" aria-label="Search everything">
        <label className="search-field">
          <SearchIcon />
          <input
            autoFocus
            value={query}
            placeholder="Search notes, sources, that.s and pages"
            aria-label="Search"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              else if (event.key === 'ArrowDown') setChosen((at) => Math.min(hits.length - 1, at + 1))
              else if (event.key === 'ArrowUp') setChosen((at) => Math.max(0, at - 1))
              else if (event.key === 'Enter') open(hits[chosen])
              else return
              event.preventDefault()
              event.stopPropagation()
            }}
          />
        </label>
        {error && <p className="search-empty">Search failed: {error}</p>}
        {!error && searched.trim().length > 0 && hits.length === 0 && <p className="search-empty">Nothing in this project matches “{searched.trim()}”.</p>}
        {hits.length > 0 && (
          <ul className="search-hits" ref={list} role="listbox">
            {hits.map((hit, at) => (
              <li key={`${hit.kind}:${hit.id}:${hit.page ?? ''}`} role="option" aria-selected={at === chosen} data-chosen={at === chosen || undefined}>
                <button type="button" className="search-hit" data-kind={hit.kind} onMouseMove={() => setChosen(at)} onClick={() => open(hit)}>
                  <span className="search-hit-mark">{markOf(hit, items)}</span>
                  <span className="search-hit-text">
                    <span className="search-hit-title">
                      {hit.title}
                      {hit.page !== undefined && <span className="search-hit-page">p. {hit.page}</span>}
                    </span>
                    {hit.snippet && <span className="search-hit-snippet">{marked(hit.snippet)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="search-foot">
          <span>↑↓ to choose</span>
          <span>↵ to open</span>
          <span>esc to close</span>
        </p>
      </div>
    </div>
  )
}

/** What kind of thing a result is: a note, a book, a link, or a *that.* chip. */
function markOf(hit: SearchHitView, items: ReadonlyMap<string, ItemView>): ReactNode {
  if (hit.kind === 'note') return <NoteIcon />
  if (hit.kind === 'that') return <span className="that-chip search-that">that.</span>
  const item = items.get(hit.itemId ?? hit.id)
  return item?.url ? <LinkIcon /> : <BookIcon />
}

/** Words the search matched are bold; they sit between \u0001 and \u0002. */
function marked(snippet: string): ReactNode[] {
  return snippet
    .replace(/\s+/g, ' ')
    .split('\u0001')
    .flatMap((part, at) => {
      if (at === 0) return [part]
      const [match = '', rest = ''] = part.split('\u0002')
      return [
        <b key={at} className="search-match">
          {match}
        </b>,
        rest,
      ]
    })
}
