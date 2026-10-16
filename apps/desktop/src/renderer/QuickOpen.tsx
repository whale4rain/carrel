import { useEffect, useRef, useState } from 'react'
import type { ItemView } from '../shared/workspace-api.js'
import { NoteIcon } from './icons.js'
import { frame } from './platform.js'

/** Notes listed at most. */
const SHOWN = 30

/**
 * Open a note by name (⌘O / Ctrl+O), as Obsidian's quick switcher does: type
 * part of a title, Enter opens it on its page, ⌘↵ / Ctrl+↵ lays it on the
 * desk, and ⇧↵ makes a new note with what you typed. With nothing typed it
 * lists the notes you changed last.
 */
export function QuickOpen({
  items,
  onOpen,
  onCreate,
  onClose,
}: {
  items: ReadonlyMap<string, ItemView>
  /** Open a note: on its page, or on the desk. */
  onOpen: (id: string, onDesk: boolean) => void
  onCreate: (title: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const wanted = query.trim().toLowerCase()
  const notes = [...items.values()].filter((item) => item.kind === 'note')
  const found = notes
    .flatMap((note) => {
      const score = scoreOf(note, wanted)
      return score === undefined ? [] : [{ note, score }]
    })
    .sort((a, b) => a.score - b.score || (b.note.updatedAt ?? '').localeCompare(a.note.updatedAt ?? ''))
    .slice(0, SHOWN)
    .map(({ note }) => note)
  const exact = notes.some((note) => note.title.toLowerCase() === wanted)
  // The last row makes a note, when something new is typed.
  const rows = found.length + (wanted && !exact ? 1 : 0)

  useEffect(() => setChosen(0), [query])
  useEffect(() => {
    list.current?.querySelector('[data-chosen]')?.scrollIntoView({ block: 'nearest' })
  }, [chosen])

  const pick = (at: number, onDesk: boolean): void => {
    const note = found[at]
    if (note) onOpen(note.id, onDesk)
    else if (wanted) onCreate(query.trim())
    else return
    onClose()
  }

  return (
    <div className="search-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="search-palette quick-open" role="dialog" aria-label="Open a note">
        <label className="search-field">
          <NoteIcon />
          <input
            autoFocus
            value={query}
            placeholder="Open a note by name"
            aria-label="Note name"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              else if (event.key === 'ArrowDown') setChosen((at) => Math.min(rows - 1, at + 1))
              else if (event.key === 'ArrowUp') setChosen((at) => Math.max(0, at - 1))
              else if (event.key === 'Enter' && event.shiftKey) {
                if (!wanted) return
                onCreate(query.trim())
                onClose()
              } else if (event.key === 'Enter') pick(chosen, event.metaKey || event.ctrlKey)
              else return
              event.preventDefault()
              event.stopPropagation()
            }}
          />
        </label>
        {rows === 0 && <p className="search-empty">{notes.length === 0 ? 'No notes yet. Type a name and press Enter to make one.' : 'No note has that name.'}</p>}
        {rows > 0 && (
          <ul className="search-hits" ref={list} role="listbox">
            {found.map((note, at) => (
              <li key={note.id} role="option" aria-selected={at === chosen} data-chosen={at === chosen || undefined}>
                <button type="button" className="search-hit" onMouseMove={() => setChosen(at)} onClick={(event) => pick(at, event.metaKey || event.ctrlKey)}>
                  <span className="search-hit-mark">
                    <NoteIcon />
                  </span>
                  <span className="search-hit-text">
                    <span className="search-hit-title">{note.title}</span>
                    {note.folder && <span className="search-hit-snippet">{note.folder}</span>}
                  </span>
                </button>
              </li>
            ))}
            {wanted && !exact && (
              <li role="option" aria-selected={chosen === found.length} data-chosen={chosen === found.length || undefined}>
                <button type="button" className="search-hit" onMouseMove={() => setChosen(found.length)} onClick={() => pick(found.length, false)}>
                  <span className="search-hit-mark">+</span>
                  <span className="search-hit-text">
                    <span className="search-hit-title">New note “{query.trim()}”</span>
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
        <p className="search-foot">
          <span>↵ to open</span>
          <span>{frame === 'mac' ? '⌘↵' : 'Ctrl+↵'} on the desk</span>
          <span>{frame === 'mac' ? '⇧↵' : 'Shift+↵'} new note</span>
          <span>esc to close</span>
        </p>
      </div>
    </div>
  )
}

/** Lower is better: the title starts with it, a word starts with it, it is in the title, its folder has it. */
function scoreOf(note: ItemView, wanted: string): number | undefined {
  if (!wanted) return 0
  const title = note.title.toLowerCase()
  if (title.startsWith(wanted)) return 0
  if (title.split(/[\s\-_/:,.()]+/).some((word) => word.startsWith(wanted))) return 1
  if (title.includes(wanted)) return 2
  if ((note.folder ?? '').toLowerCase().includes(wanted)) return 3
  return undefined
}
