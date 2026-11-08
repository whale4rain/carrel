import { useEffect, useRef, useState } from 'react'
import type { ItemView, MarginLine, MarginMode, MentionView, NoteDoc, PropertyValue } from '../shared/workspace-api.js'
import { bandRanges, DRAFT_BAND, setBands } from './bands.js'
import { MarginLayer, type MarginDraft } from './Margin.js'
import { NoteProperties } from './NoteProperties.js'
import { NoteView } from './NoteView.js'
import { rangeAt, textOf } from './that.js'

const api = window.carrel.workspace
const agent = window.carrel.agent

/** The note page, as the margin knows it. */
const PAGE = 'note-page'
/** How long you pause before the agent reads what you just wrote, and how long it then keeps quiet. */
const PAUSE = 3500
const QUIET = 30_000
/** A passage worth reading along: a finished sentence of some length. */
const FINISHED = /[.?!。？！]["”’)]?$/
const LONG_ENOUGH = 40

const noteBand = (line: string): string => `note:${line}`

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
  /** Sets one of the note's properties, or takes it away (`null`). */
  onProperty: (key: string, value: PropertyValue | null) => Promise<void>
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
export function NotePage({ note, items, write, onSaved, onOpenThat, onOpenItem, onPutOnDesk, onPin, onOpenLink, onLinked, onProperty }: Props) {
  const [headings, setHeadings] = useState<Heading[]>([])
  // Lines into this note's margin, words just selected, and whether the agent thinks with you here.
  const [lines, setLines] = useState<MarginLine[]>([])
  const [draft, setDraft] = useState<MarginDraft>()
  const [mode, setMode] = useState<MarginMode>('with')
  const [marginError, setMarginError] = useState<string>()
  const content = useRef<HTMLDivElement>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let current = true
    void Promise.all([api.marginLines(), api.marginModes()]).then(([all, modes]) => {
      if (!current) return
      setLines(all.filter((line) => line.itemId === note.id))
      setMode(modes[note.id] ?? 'with')
    })
    return () => {
      current = false
    }
  }, [note.id])

  // Each line's words in the note, found again by their quote as the note changes.
  useEffect(() => {
    const text = content.current?.querySelector('.note-text')
    if (!text) return
    const found = textOf(text)
    for (const line of lines) {
      const at = line.quote ? found.source.indexOf(line.quote) : -1
      const range = at < 0 ? undefined : rangeAt(found, at, at + line.quote!.length)
      setBands(noteBand(line.id), range ? [range] : [])
    }
    return () => {
      for (const line of lines) setBands(noteBand(line.id), [])
    }
  }, [lines, version])

  // Thinking with you: after a pause, the agent reads the passage you just finished and may say one thing.
  const seen = useRef<Set<string>>(undefined)
  const pause = useRef<number>(undefined)
  const quietUntil = useRef(0)
  const latest = useRef({ mode, title: note.title, id: note.id })
  latest.current = { mode, title: note.title, id: note.id }
  useEffect(() => {
    seen.current = undefined
    return () => window.clearTimeout(pause.current)
  }, [note.id])
  const readAlong = (doc: NoteDoc): void => {
    const passages = doc.content.flatMap((block) => (block.type === 'paragraph' ? [plain(block.content ?? []).trim()] : []))
    // What was there when the note opened is not news.
    if (!seen.current) {
      seen.current = new Set(passages)
      return
    }
    window.clearTimeout(pause.current)
    if (latest.current.mode !== 'with') return
    const fresh = passages.filter((passage) => !seen.current!.has(passage) && passage.length >= LONG_ENOUGH && FINISHED.test(passage)).at(-1)
    if (!fresh) return
    pause.current = window.setTimeout(() => {
      if (Date.now() < quietUntil.current || latest.current.mode !== 'with' || latest.current.id !== note.id) return
      seen.current!.add(fresh)
      quietUntil.current = Date.now() + QUIET
      void agent.muse(fresh, latest.current.title).then(
        async (said) => {
          if (!said || latest.current.id !== note.id) return
          const line = await api.drawLine({ itemId: note.id, quote: fresh, by: 'agent', entries: [{ by: 'agent', text: said }] })
          setLines((all) => [...all, line])
        },
        () => undefined,
      )
    }, PAUSE)
  }
  const changeMode = (next: MarginMode): void => {
    setMode(next)
    void api.setMarginMode(note.id, next).catch(() => undefined)
  }
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
    <main className="note-page" aria-label={`Note: ${note.title}`} data-margin="">
      <div className="note-page-paper">
        <div
          className="note-page-content"
          ref={content}
          onMouseUp={(event) => {
            // Words selected in the note open the margin's box, with a line to it.
            if (event.button !== 0 || !(event.target as HTMLElement).closest('.note-text')) return
            const selection = window.getSelection()
            const quote = selection?.toString().trim() ?? ''
            if (!selection || selection.isCollapsed || selection.rangeCount === 0 || quote.length < 2) return
            setBands(DRAFT_BAND, [selection.getRangeAt(0).cloneRange()])
            setDraft({ sheet: PAGE, itemId: note.id, title: note.title, point: () => Promise.resolve({ quote }) })
          }}
        >
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
          <span className="margin-mode" role="group" aria-label="The agent in this note">
            <button type="button" aria-pressed={mode === 'with'} title="It reads along and may write one thing in the margin when you pause" onClick={() => changeMode('with')}>
              Thinks with you
            </button>
            <button type="button" aria-pressed={mode === 'ask'} title="It stays quiet until you select words and ask" onClick={() => changeMode('ask')}>
              When you ask
            </button>
          </span>
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
          onDoc={(doc) => {
            setHeadings(headingsOf(doc))
            setVersion((count) => count + 1)
            readAlong(doc)
          }}
          underTitle={<NoteProperties properties={note.properties ?? {}} onSet={onProperty} />}
        />
        <MarginLayer
          world={content}
          zoom={1}
          sheets={[{ id: PAGE, itemId: note.id, paper: () => content.current?.querySelector<HTMLElement>('.note-text') ?? null }]}
          lines={lines}
          draft={draft}
          anchor={(line) => bandRanges(noteBand(line.id))}
          onLines={setLines}
          onDraftDone={() => setDraft(undefined)}
          onKept={onSaved}
          onError={setMarginError}
        />
        {marginError && (
          <p className="note-margin-error" role="alert">
            {marginError}
          </p>
        )}
        </div>
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

/** A paragraph's words, as the margin quotes them. */
function plain(content: NonNullable<Extract<NoteDoc['content'][number], { type: 'paragraph' }>['content']>): string {
  return content.map((inline) => (inline.type === 'text' ? inline.text : inline.type === 'that' ? inline.attrs.label : inline.type === 'noteLink' ? inline.attrs.label || inline.attrs.target : '')).join('')
}
