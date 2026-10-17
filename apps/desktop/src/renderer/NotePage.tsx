import { useEffect, useState } from 'react'
import type { ItemView, MentionView, NoteDoc } from '../shared/workspace-api.js'
import { NoteView } from './NoteView.js'

const api = window.carrel.workspace

interface Props {
  note: ItemView
  items: ReadonlyMap<string, ItemView>
  /** Start writing at once (a note just made). */
  write: boolean
  onSaved: (item: ItemView) => void
  onOpenThat: (id: string) => void
  /** Opens a source on the desk, or a note on its page. */
  onOpenItem: (id: string) => void
  /** Lays this note on the open desk. */
  onPutOnDesk: () => void
  /** Pins the note to the top of the sidebar, or lets it go. */
  onPin: (pinned: boolean) => void
  /** A [[link]] was clicked. */
  onOpenLink: (target: string) => void
  /** A mention was made a link, in the note given. */
  onLinked: (note: ItemView) => void
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
export function NotePage({ note, items, write, onSaved, onOpenThat, onOpenItem, onPutOnDesk, onPin, onOpenLink, onLinked }: Props) {
  const [headings, setHeadings] = useState<Heading[]>([])
  const notes = [...items.values()].filter((item) => item.kind === 'note')
  // Who links here and who names it without a link, asked again whenever a note changes.
  const [mentions, setMentions] = useState<{ linked: MentionView[]; unlinked: MentionView[] }>()
  const changed = notes.map((other) => `${other.id}:${other.updatedAt ?? ''}`).join()
  useEffect(() => {
    let current = true
    void api.mentions(note.id).then(
      (found) => current && setMentions(found),
      () => current && setMentions(undefined),
    )
    return () => {
      current = false
    }
  }, [note.id, changed])
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
          <button type="button" className="outline-button" aria-pressed={note.pinned === true} onClick={() => onPin(!note.pinned)}>
            {note.pinned ? 'Unpin' : 'Pin'}
          </button>
          <button type="button" className="outline-button" onClick={onPutOnDesk}>
            Put on desk
          </button>
        </header>
        <NoteView
          key={note.id}
          item={note}
          write={write}
          cites={undefined}
          notes={notes}
          onSaved={onSaved}
          onOpenThat={onOpenThat}
          onOpenLink={onOpenLink}
          onDoc={(doc) => setHeadings(headingsOf(doc))}
        />
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
        <section aria-label="Linked here">
          <h2>
            Linked here <span className="count">{mentions?.linked.length ?? 0}</span>
          </h2>
          {mentions && mentions.linked.length === 0 && <p className="note-margin-empty">Type [[ in another note to link to this one.</p>}
          <ul className="note-mentions">
            {mentions?.linked.map((mention) => (
              <li key={mention.id}>
                <button type="button" onClick={() => onOpenItem(mention.id)}>
                  <b>{mention.title}</b>
                  <span>{mention.snippet}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        {mentions && mentions.unlinked.length > 0 && (
          <section aria-label="Mentioned, not linked">
            <h2>
              Mentioned, not linked <span className="count">{mentions.unlinked.length}</span>
            </h2>
            <ul className="note-mentions">
              {mentions.unlinked.map((mention) => (
                <li key={mention.id} className="unlinked">
                  <span>
                    <b>{mention.title}</b>
                    <span>{mention.snippet}</span>
                  </span>
                  <button type="button" className="outline-button small" onClick={() => void api.linkMention(mention.id, note.id).then(onLinked)}>
                    Link
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
