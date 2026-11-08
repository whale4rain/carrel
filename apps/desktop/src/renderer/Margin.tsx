import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ItemView, MarginLine } from '../shared/workspace-api.js'
import { bandRanges, DRAFT_BAND, onBands, setBands } from './bands.js'
import { Markdown } from './Markdown.js'

const api = window.carrel.workspace
const agent = window.carrel.agent

/** The margin column beside a sheet, in desk units. */
const GAP = 22
const WIDTH = 248
/** Room between two notes in one margin. */
const SPACE = 12

/** Words just selected in a sheet, waiting in the margin's open box. */
export interface MarginDraft {
  sheet: string
  itemId: string
  /** Keeps what was pointed at: a *that.* in a source, or the quoted words in a note. */
  point: () => Promise<{ that?: string; quote?: string }>
  /** The note the words are in, for the agent. */
  title?: string
}

/** A sheet on the desk that can have lines: its id and the item on it. */
export interface MarginSheet {
  id: string
  itemId: string
  /** The element the margin sits beside; on the desk, the sheet's paper. */
  paper?: () => HTMLElement | null
}

interface Placed {
  key: string
  sheet: string
  /** Where the words end, and the sheet's right edge, in desk units. */
  x: number
  y: number
  edge: number
  /** The note in the margin. */
  left: number
  top: number
}

/**
 * The margin beside each sheet: lines run from words in a source or a note,
 * under the rest of their line of text, out to what is written beside them.
 * You write a note there or ask the agent, and its answer is written in at
 * the end of the line. Lines are drawn in desk units inside the desk's world,
 * so they move and zoom with the sheets.
 */
export function MarginLayer({
  world,
  zoom,
  sheets,
  lines,
  draft,
  anchor,
  onLines,
  onDraftDone,
  onKept,
  onError,
}: {
  world: RefObject<HTMLDivElement | null>
  zoom: number
  sheets: readonly MarginSheet[]
  lines: readonly MarginLine[]
  draft: MarginDraft | undefined
  /** Where a line's words are on a sheet now (empty when they aren't drawn). */
  anchor: (line: MarginLine, sheet: string) => readonly Range[]
  onLines: (change: (lines: MarginLine[]) => MarginLine[]) => void
  onDraftDone: () => void
  /** An answer was kept as a note. */
  onKept: (note: ItemView) => void
  onError: (message: string) => void
}) {
  const [placed, setPlaced] = useState<Placed[]>([])
  const [active, setActive] = useState<string>()
  const [answering, setAnswering] = useState<Map<string, string>>(new Map())
  // Lines whose answer was kept, with the note's title.
  const [kept, setKept] = useState<Map<string, string>>(new Map())
  const notes = useRef(new Map<string, HTMLElement>())
  const [tick, setTick] = useState(0)
  const frame = useRef<number>(undefined)
  const bump = useCallback(() => {
    if (frame.current !== undefined) return
    frame.current = requestAnimationFrame(() => {
      frame.current = undefined
      setTick((count) => count + 1)
    })
  }, [])

  // Lines follow the words: when a page draws its text, a sheet scrolls, or the window changes.
  useEffect(() => {
    const off = onBands(bump)
    document.addEventListener('scroll', bump, true)
    window.addEventListener('resize', bump)
    return () => {
      off()
      document.removeEventListener('scroll', bump, true)
      window.removeEventListener('resize', bump)
    }
  }, [bump])

  // A press anywhere else closes the open line, and lets an empty box go.
  const draftOpen = draft !== undefined
  const closeDraft = useRef(onDraftDone)
  closeDraft.current = onDraftDone
  useEffect(() => {
    const away = (event: PointerEvent): void => {
      if ((event.target as Element | null)?.closest?.('.margin-layer')) return
      setActive(undefined)
      const box = document.querySelector<HTMLTextAreaElement>('.margin-box textarea')
      if (draftOpen && !box?.value.trim()) {
        setBands(DRAFT_BAND, [])
        closeDraft.current()
      }
    }
    document.addEventListener('pointerdown', away, true)
    return () => document.removeEventListener('pointerdown', away, true)
  }, [draftOpen])

  // Where each line starts and where its note sits, measured from the drawn words.
  useLayoutEffect(() => {
    const element = world.current
    if (!element) return
    const origin = element.getBoundingClientRect()
    const toWorld = (x: number, y: number): { x: number; y: number } => ({ x: (x - origin.left) / zoom, y: (y - origin.top) / zoom })
    const next: Placed[] = []
    for (const sheet of sheets) {
      const paper = sheet.paper ? sheet.paper() : element.querySelector<HTMLElement>(`.sheet[data-sheet="${CSS.escape(sheet.id)}"] .sheet-paper`)
      if (!paper) continue
      const box = paper.getBoundingClientRect()
      const right = toWorld(box.right, box.top)
      const wanted: Array<{ key: string; x: number; y: number }> = []
      const startOf = (ranges: readonly Range[]): { x: number; y: number } | undefined => {
        const rects = ranges.flatMap((range) => [...range.getClientRects()]).filter((rect) => rect.width > 0)
        const last = rects.at(-1)
        // Words scrolled out of their sheet have no line.
        if (!last || last.bottom < box.top || last.top > box.bottom) return undefined
        return toWorld(last.right, last.bottom)
      }
      for (const line of lines) {
        if (line.itemId !== sheet.itemId) continue
        const at = startOf(anchor(line, sheet.id))
        if (at) wanted.push({ key: line.id, ...at })
      }
      if (draft?.sheet === sheet.id) {
        const at = startOf(bandRanges(DRAFT_BAND))
        if (at) wanted.push({ key: DRAFT_BAND, ...at })
      }
      // Notes sit level with their words, pushed down so none overlap.
      wanted.sort((a, b) => a.y - b.y)
      let floor = -Infinity
      for (const one of wanted) {
        const top = Math.max(one.y - 14, floor)
        const height = notes.current.get(one.key)?.offsetHeight ?? 56
        floor = top + height + SPACE
        next.push({ key: one.key, sheet: sheet.id, x: one.x, y: one.y, edge: right.x, left: right.x + GAP, top })
      }
    }
    setPlaced((now) => (JSON.stringify(now) === JSON.stringify(next) ? now : next))
  })
  // `tick` re-renders; the layout effect above runs after every render.
  void tick

  const ask = async (line: MarginLine, question: string, quote?: string, title?: string): Promise<void> => {
    setAnswering((now) => new Map(now).set(line.id, ''))
    const off = agent.onLive((event) => {
      if (event.type === 'text') setAnswering((now) => (now.has(line.id) ? new Map(now).set(line.id, event.text) : now))
    })
    try {
      const turn = await agent.ask(question, { points: line.that ? [line.that] : [], margin: { ...(quote ? { quote } : {}), ...(title ? { title } : {}) } })
      const text = turn.error ? `I couldn't answer: ${turn.error}` : turn.text
      const added = await api.addToLine(line.id, { by: 'agent', text, ...(turn.error ? {} : { turnId: turn.id }) })
      onLines((all) => all.map((known) => (known.id === added.id ? added : known)))
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      off()
      setAnswering((now) => {
        const next = new Map(now)
        next.delete(line.id)
        return next
      })
    }
  }

  const startLine = async (text: string, asking: boolean): Promise<void> => {
    if (!draft) return
    const words = text.trim()
    try {
      const pointed = await draft.point()
      const line = await api.drawLine({ itemId: draft.itemId, ...pointed, entries: [{ by: 'user', text: words || 'Explain this.' }] })
      onLines((all) => [...all, line])
      setBands(DRAFT_BAND, [])
      onDraftDone()
      setActive(line.id)
      if (asking) await ask(line, words || 'Explain this in plain words.', pointed.quote, draft.title)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const reply = async (line: MarginLine, text: string, asking: boolean): Promise<void> => {
    const words = text.trim()
    if (!words) return
    try {
      const added = await api.addToLine(line.id, { by: 'user', text: words })
      onLines((all) => all.map((known) => (known.id === added.id ? added : known)))
      if (asking) await ask(added, words, line.quote)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const keep = async (line: MarginLine): Promise<void> => {
    const last = line.entries.findLast((entry) => entry.by === 'agent' && entry.turnId)
    if (!last?.turnId) return
    try {
      const note = await agent.addToNote(last.turnId)
      onKept(note)
      setKept((now) => new Map(now).set(line.id, note.title))
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const erase = async (line: MarginLine): Promise<void> => {
    try {
      await api.eraseLine(line.id)
      onLines((all) => all.filter((known) => known.id !== line.id))
      setActive(undefined)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const byId = new Map(lines.map((line) => [line.id, line]))
  const keep2 = (key: string) => (element: HTMLElement | null) => {
    if (element) notes.current.set(key, element)
    else notes.current.delete(key)
  }

  return (
    <div className="margin-layer" onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <svg className="margin-lines" aria-hidden>
        {placed.map((one) => (
          <path
            key={one.key}
            data-line={one.key}
            data-active={one.key === active || one.key === DRAFT_BAND || undefined}
            d={`M${one.x},${one.y} L${one.edge},${one.y} C${one.edge + GAP * 0.6},${one.y} ${one.left - GAP * 0.6},${one.top + 12} ${one.left - 3},${one.top + 12}`}
            pathLength={1}
          />
        ))}
      </svg>
      {placed.map((one) => {
        if (one.key === DRAFT_BAND) {
          return draft ? <DraftBox key={draft.sheet + DRAFT_BAND} at={one} refer={keep2(DRAFT_BAND)} onDone={(text, asking) => void startLine(text, asking)} onCancel={() => (setBands(DRAFT_BAND, []), onDraftDone())} /> : null
        }
        const line = byId.get(one.key)
        if (!line) return null
        return (
          <MarginNote
            key={one.key}
            at={one}
            line={line}
            refer={keep2(one.key)}
            active={active === line.id}
            answer={answering.get(line.id)}
            kept={kept.get(line.id)}
            onActivate={() => setActive(line.id)}
            onClose={() => setActive(undefined)}
            onReply={(text, asking) => void reply(line, text, asking)}
            onKeep={() => void keep(line)}
            onErase={() => void erase(line)}
          />
        )
      })}
    </div>
  )
}

function DraftBox({ at, refer, onDone, onCancel }: { at: Placed; refer: (element: HTMLElement | null) => void; onDone: (text: string, asking: boolean) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  return (
    <div ref={refer} className="margin-box" role="dialog" aria-label="Write in the margin" style={{ left: at.left, top: at.top, width: WIDTH }}>
      <textarea
        ref={input}
        aria-label="Write a note, or ask"
        placeholder="Write a note, or ask…"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (event.metaKey || event.ctrlKey) {
              if (text.trim()) onDone(text, false)
            } else onDone(text, true)
          }
        }}
      />
      <div className="margin-box-row">
        <button type="button" disabled={!text.trim()} onClick={() => onDone(text, false)}>
          Note
        </button>
        <button type="button" className="main" onClick={() => onDone(text, true)}>
          {text.trim() ? 'Ask' : 'Explain'} <kbd>↵</kbd>
        </button>
        <button type="button" aria-label="Close" className="margin-close" onClick={onCancel}>
          ×
        </button>
      </div>
    </div>
  )
}

function MarginNote({
  at,
  line,
  refer,
  active,
  answer,
  kept,
  onActivate,
  onClose,
  onReply,
  onKeep,
  onErase,
}: {
  at: Placed
  line: MarginLine
  refer: (element: HTMLElement | null) => void
  active: boolean
  answer: string | undefined
  kept: string | undefined
  onActivate: () => void
  onClose: () => void
  onReply: (text: string, asking: boolean) => void
  onKeep: () => void
  onErase: () => void
}) {
  const [text, setText] = useState('')
  const answered = line.entries.some((entry) => entry.by === 'agent' && entry.turnId)
  return (
    <div
      ref={refer}
      className="margin-note"
      data-by={line.by}
      data-active={active || undefined}
      style={{ left: at.left, top: at.top, width: WIDTH }}
      onClick={() => {
        if (!active) onActivate()
      }}
    >
      {line.entries.map((entry, index) =>
        entry.by === 'agent' ? (
          <Markdown key={index} className="margin-pencil" text={entry.text} />
        ) : (
          <p key={index} className="margin-ink">
            {entry.text}
          </p>
        ),
      )}
      {answer !== undefined &&
        (answer ? (
          <Markdown className="margin-pencil" text={answer} />
        ) : (
          <p className="margin-thinking">
            <i className="ink-wait" aria-hidden />
            Thinking…
          </p>
        ))}
      {kept && <p className="margin-kept">Kept in “{kept}”</p>}
      {active && answer === undefined && (
        <div className="margin-reply">
          <textarea
            autoFocus
            aria-label="Answer, or ask more"
            placeholder="Answer, or ask more…"
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose()
              else if (event.key === 'Tab' && !text.trim() && answered) {
                event.preventDefault()
                onKeep()
              } else if (event.key === 'Enter' && !event.shiftKey && text.trim()) {
                event.preventDefault()
                onReply(text, !(event.metaKey || event.ctrlKey))
                setText('')
              }
            }}
          />
          <div className="margin-box-row">
            {answered && (
              <button type="button" onClick={onKeep} title="Keep the answer as a note (Tab)">
                Keep as note <kbd>Tab</kbd>
              </button>
            )}
            <button type="button" className="margin-close" aria-label="Rub out this line" title="Rub out this line" onClick={onErase}>
              Rub out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
