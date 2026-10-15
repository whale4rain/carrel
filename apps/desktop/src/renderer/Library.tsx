import { useEffect, useRef, useState } from 'react'
import type { ItemView } from '../shared/workspace-api.js'
import { BookIcon, LinkIcon, NoteIcon, SearchIcon, SparkIcon } from './icons.js'
import { KIND_LABEL, sourceLine } from './sources.js'

/** The library's shelves, as the sidebar lists them. */
export type Shelf = 'books' | 'videos' | 'web' | 'notes' | 'agent'

export const SHELVES: ReadonlyArray<{ id: Shelf; label: string; holds: (item: ItemView) => boolean }> = [
  { id: 'books', label: 'Books & papers', holds: (item) => item.kind === 'book' || item.kind === 'paper' },
  { id: 'videos', label: 'Videos', holds: (item) => item.kind === 'video' },
  { id: 'web', label: 'Web pages', holds: (item) => item.kind === 'web_page' },
  { id: 'notes', label: 'Notes', holds: (item) => item.kind === 'note' },
  { id: 'agent', label: 'Made by the agent', holds: (item) => item.createdBy === 'agent' },
]

/**
 * The project's library: every source and note, by shelf, newest first.
 * Typing filters by title, address or #tag; a row opens its item on the desk.
 * Esc closes.
 */
export function Library({
  items,
  shelf: first,
  onDesk,
  onOpen,
  onClose,
}: {
  items: ReadonlyMap<string, ItemView>
  shelf: Shelf
  /** Items on the open desk. */
  onDesk: ReadonlySet<string>
  onOpen: (item: ItemView) => void
  onClose: () => void
}) {
  const [shelf, setShelf] = useState(first)
  const [query, setQuery] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => setShelf(first), [first])
  useEffect(() => field.current?.focus(), [shelf])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const all = [...items.values()]
  const citedBy = new Map<string, number>()
  for (const note of all) for (const source of note.cites ?? []) citedBy.set(source, (citedBy.get(source) ?? 0) + 1)
  const holds = SHELVES.find((entry) => entry.id === shelf)!.holds
  const words = query.trim().toLowerCase()
  const shown = all
    .filter(holds)
    .filter((item) => words === '' || [item.title, item.url ?? '', ...(item.tags ?? []).map((tag) => `#${tag}`)].some((text) => text.toLowerCase().includes(words)))
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''))

  return (
    <div
      className="library-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="library" role="dialog" aria-label="Library">
        <header className="library-head">
          <h2>Library</h2>
          <div className="library-shelves" role="tablist" aria-label="Shelves">
            {SHELVES.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={entry.id === shelf} onClick={() => setShelf(entry.id)}>
                {entry.label} <span className="count">{all.filter(entry.holds).length}</span>
              </button>
            ))}
          </div>
          <label className="search-field">
            <SearchIcon />
            <input ref={field} value={query} placeholder="Filter by title, address or #tag" aria-label="Filter the library" onChange={(event) => setQuery(event.target.value)} />
          </label>
        </header>
        <ul className="library-list" aria-label="Items">
          {shown.map((item) => (
            <li key={item.id}>
              <button type="button" className="library-row" onClick={() => onOpen(item)}>
                <span className="library-icon" aria-hidden>
                  {item.kind === 'note' ? <NoteIcon /> : item.file ? <BookIcon /> : <LinkIcon />}
                </span>
                <span className="library-main">
                  <span className="library-title">{item.title}</span>
                  <span className="library-meta position">{metaLine(item, citedBy.get(item.id) ?? 0)}</span>
                </span>
                {item.createdBy === 'agent' && (
                  <span className="library-agent" title="Made by the agent">
                    <SparkIcon />
                  </span>
                )}
                <span className="library-where">{onDesk.has(item.id) ? 'On this desk' : 'Put on desk'}</span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="library-empty">{words ? 'Nothing here matches.' : emptyLine(shelf)}</li>}
        </ul>
      </section>
    </div>
  )
}

/** "PDF · 1.2 MB · 2 notes", "example.com · linked", "#tag · 14 Oct". */
function metaLine(item: ItemView, notes: number): string {
  const parts: string[] = []
  if (item.kind === 'note') {
    parts.push(...(item.tags ?? []).map((tag) => `#${tag}`))
    if (item.cites && item.cites.length > 0) parts.push(item.cites.length === 1 ? 'cites 1 source' : `cites ${item.cites.length} sources`)
  } else {
    parts.push(item.file ? sourceLine(item) : `${KIND_LABEL[item.kind]} · ${sourceLine(item)} · linked`)
    if (notes > 0) parts.push(notes === 1 ? '1 note' : `${notes} notes`)
  }
  const when = item.updatedAt ?? item.createdAt
  if (when) parts.push(new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))
  return parts.join(' · ')
}

function emptyLine(shelf: Shelf): string {
  if (shelf === 'books') return 'No books or papers yet. Drop a PDF on the desk, or use + Add.'
  if (shelf === 'videos' || shelf === 'web') return 'Nothing linked yet. Paste a link on the desk, or use + Add.'
  if (shelf === 'notes') return 'No notes yet.'
  return 'The agent hasn’t added anything yet. What it proposes and you accept shows here.'
}
