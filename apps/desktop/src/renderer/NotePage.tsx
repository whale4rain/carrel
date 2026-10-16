import { useState } from 'react'
import type { ItemView, NoteDoc } from '../shared/workspace-api.js'
import { NoteView } from './NoteView.js'

interface Props {
  note: ItemView
  items: ReadonlyMap<string, ItemView>
  /** Start writing at once (a note just made). */
  write: boolean
  onSaved: (item: ItemView) => void
  onOpenThat: (id: string) => void
  /** Opens a source on the desk. */
  onOpenItem: (id: string) => void
  /** Lays this note on the open desk. */
  onPutOnDesk: () => void
}

interface Heading {
  level: number
  text: string
}

/**
 * A note on its own page, the way Notion and Obsidian show one: the folder it
 * is in, the note in the middle at a reading width, and a margin beside it
 * with the note's outline and the sources it cites. Nothing here needs a
 * desk; Put on desk lays the note beside your sources.
 */
export function NotePage({ note, items, write, onSaved, onOpenThat, onOpenItem, onPutOnDesk }: Props) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const folders = note.folder ? note.folder.split('/') : []
  const cited = (note.cites ?? []).flatMap((id) => {
    const item = items.get(id)
    return item ? [item] : []
  })

  const goTo = (index: number): void => {
    const found = document.querySelectorAll('.note-page .note-text :is(h1, h2, h3)')[index]
    found?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <main className="note-page" aria-label={`Note: ${note.title}`}>
      <div className="note-page-paper">
        <header className="note-page-head">
          <span className="note-page-path">
            {folders.length > 0 ? folders.join(' / ') : 'Notes'}
            {note.updatedAt && <span className="note-page-edited"> · edited {edited(note.updatedAt)}</span>}
          </span>
          <button type="button" className="outline-button" onClick={onPutOnDesk}>
            Put on desk
          </button>
        </header>
        <NoteView key={note.id} item={note} write={write} cites={undefined} onSaved={onSaved} onOpenThat={onOpenThat} onDoc={(doc) => setHeadings(headingsOf(doc))} />
      </div>
      <aside className="note-margin" aria-label="Margin">
        {headings.length > 1 && (
          <section>
            <h2>On this page</h2>
            <ul className="note-outline">
              {headings.map((heading, index) => (
                <li key={index} data-level={heading.level}>
                  <button type="button" onClick={() => goTo(index)}>
                    {heading.text}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2>
            Cites <span className="count">{cited.length}</span>
          </h2>
          {cited.length === 0 ? (
            <p className="note-margin-empty">Put the note on a desk beside a source, then drag a that. into it.</p>
          ) : (
            <ul className="note-margin-list">
              {cited.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => onOpenItem(item.id)}>
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </main>
  )
}

function headingsOf(doc: NoteDoc): Heading[] {
  return doc.content.flatMap((block) => {
    if (block.type !== 'heading') return []
    const text = (block.content ?? []).map((inline) => (inline.type === 'text' ? inline.text : inline.type === 'that' ? inline.attrs.label : '')).join('').trim()
    return text ? [{ level: block.attrs.level, text }] : []
  })
}

/** "just now", "5 min ago", "today 14:02", "14 Oct". */
function edited(at: string): string {
  const then = new Date(at)
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (then.toDateString() === new Date().toDateString()) return `today ${then.toTimeString().slice(0, 5)}`
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
