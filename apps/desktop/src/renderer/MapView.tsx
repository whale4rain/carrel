import { dayLabel, timeLabel } from '@carrel/memory/days'
import { CARD, MAP_RANGES, mapLayout, type MapRange } from '@carrel/memory/map'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Line, MapData, Piece, Recalled } from '../shared/memory-api.js'
import { shortcutLabel } from '../shared/shortcuts.js'
import type { Frame } from '../shared/frame.js'

const memory = window.carrel.memory

interface Props {
  frame: Frame
  /** A project is open, so a piece can become a note or its page go on a desk. */
  canWrite: boolean
  /** Makes a note from a piece and opens it. */
  onWriteMore(piece: Piece): void
  /** Opens a page on the desk. */
  onOpenUrl(url: string): void
}

/**
 * The map (phase 3): what you learned, by day from left to right, in loose
 * groups, with lines between pieces from different days. Lines drawn today
 * are highlighted; earlier ones are graphite. A piece's lines are listed as
 * text beside it, each with × to remove it for good.
 */
export function MapView({ frame, canWrite, onWriteMore, onOpenUrl }: Props) {
  const [range, setRange] = useState<MapRange>(() => {
    try {
      const saved = localStorage.getItem('carrel.map.range')
      return saved === 'month' || saved === 'all' ? saved : '2w'
    } catch {
      return '2w'
    }
  })
  const [data, setData] = useState<MapData>()
  const [selected, setSelected] = useState<string>()
  const [found, setFound] = useState<Recalled>()
  const [width, setWidth] = useState(900)
  const canvas = useRef<HTMLDivElement>(null)

  // A slower, older read must not draw over a newer one.
  const latest = useRef(0)
  const load = useCallback(async (): Promise<void> => {
    const ticket = ++latest.current
    const next = await memory.map(range)
    if (ticket !== latest.current) return
    setData(next)
    setSelected((now) => (now && next.pieces.some((piece) => piece.id === now) ? now : newest(next)?.id))
  }, [range])
  useEffect(() => {
    void load()
    try {
      localStorage.setItem('carrel.map.range', range)
    } catch {
      // Not remembered; it still works.
    }
  }, [load, range])
  // Something kept or made into pieces elsewhere: read the map again.
  useEffect(() => memory.onKept(() => void load()), [load])
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => (data ? mapLayout(data.pieces, data.lines, { today: data.today, first: data.first, width }) : undefined), [data, width])
  // The map opens at today, its right end.
  const scrolled = useRef<string>(undefined)
  useLayoutEffect(() => {
    const element = canvas.current
    if (!element || !layout || scrolled.current === `${range}:${layout.width}`) return
    scrolled.current = `${range}:${layout.width}`
    element.scrollLeft = element.scrollWidth
  }, [layout, range])
  const byId = useMemo(() => new Map((data?.pieces ?? []).map((piece) => [piece.id, piece])), [data])
  const piece = selected ? byId.get(selected) : undefined

  const removeLine = async (id: string): Promise<void> => {
    await memory.removeLine(id)
    await load()
  }
  const select = (id: string): void => {
    setFound(undefined)
    setSelected(id)
  }

  return (
    <section className="memory-map" aria-label="Map">
      <header className="map-head">
        <h1>What you’ve learned</h1>
        <div className="map-range" role="group" aria-label="Range">
          {MAP_RANGES.map((option) => (
            <button key={option.id} type="button" aria-pressed={range === option.id} onClick={() => setRange(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
        <MapSearch
          onPiece={(hit) => {
            if (data && hit.day < data.first) setRange('all')
            select(hit.id)
          }}
          onCapture={(hit) => {
            setSelected(undefined)
            setFound(hit)
          }}
        />
        <button type="button" className="map-keep" onClick={() => void memory.openKeep()}>
          Keep <kbd>{shortcutLabel(frame, 'keep')}</kbd>
        </button>
      </header>
      <div className="map-body">
        <div className="map-canvas" ref={canvas}>
          {layout && layout.cards.length === 0 ? (
            <div className="map-empty">
              <p className="map-empty-title">Nothing on the map yet</p>
              <p>Your chats, pages on your reading trail and what you keep with {shortcutLabel(frame, 'keep')} become pieces each evening.</p>
            </div>
          ) : (
            layout && (
              <div className="map-plane" style={{ width: layout.width, height: layout.height }}>
                {/* The group names stay at the left edge while the map scrolls back in time. */}
                <div className="map-bands" style={{ height: layout.height }}>
                  {layout.bands.map((band) => (
                    <p key={band.name} className="map-band" style={{ top: band.y }}>
                      {band.name}
                    </p>
                  ))}
                </div>
                <svg className="map-lines" width={layout.width} height={layout.height} aria-hidden>
                  {layout.lines.map(({ line, d, fresh }) => (
                    <path key={line.id} d={d} data-fresh={fresh || undefined} data-selected={line.from === selected || line.to === selected || undefined} />
                  ))}
                </svg>
                {layout.cards.map((card) => (
                  <button
                    key={card.piece.id}
                    type="button"
                    className="map-card"
                    style={{ left: card.x, top: card.y, width: CARD.width, minHeight: CARD.height }}
                    aria-pressed={card.piece.id === selected}
                    data-today={card.today || undefined}
                    onClick={() => select(card.piece.id)}
                  >
                    <span className="map-card-meta">
                      <span>{card.piece.source.label}</span>
                      {card.today ? <span className="map-today">Today</span> : <span className="map-day">{dayLabel(card.piece.day)}</span>}
                    </span>
                    <span className="map-card-title">{card.piece.title}</span>
                  </button>
                ))}
                <div className="map-axis" style={{ top: layout.height - 36 }} aria-hidden>
                  {layout.ticks.map((tick) => (
                    <span key={tick.day} style={{ left: tick.x }}>
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
        {piece && data && (
          <PieceDetail
            key={piece.id}
            piece={piece}
            today={data.today}
            lines={data.lines.filter((line) => line.from === piece.id || line.to === piece.id)}
            byId={byId}
            canWrite={canWrite}
            onSelect={select}
            onRemoveLine={(id) => void removeLine(id)}
            onEdited={() => void load()}
            onRemoved={() => {
              setSelected(undefined)
              void load()
            }}
            onWriteMore={() => onWriteMore(piece)}
            onOpenUrl={onOpenUrl}
          />
        )}
        {found && !piece && <FoundDetail found={found} canWrite={canWrite} onOpenUrl={onOpenUrl} onClose={() => setFound(undefined)} />}
      </div>
    </section>
  )
}

function PieceDetail({
  piece,
  today,
  lines,
  byId,
  canWrite,
  onSelect,
  onRemoveLine,
  onEdited,
  onRemoved,
  onWriteMore,
  onOpenUrl,
}: {
  piece: Piece
  today: string
  lines: Line[]
  byId: ReadonlyMap<string, Piece>
  canWrite: boolean
  onSelect(id: string): void
  onRemoveLine(id: string): void
  onEdited(): void
  onRemoved(): void
  onWriteMore(): void
  onOpenUrl(url: string): void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(piece.title)
  const [body, setBody] = useState(piece.body)
  const fresh = lines.filter((line) => line.drawnOn === today).length
  const sorted = [...lines].sort((a, b) => Number(b.drawnOn === today) - Number(a.drawnOn === today) || b.drawnAt.localeCompare(a.drawnAt))
  const save = async (): Promise<void> => {
    await memory.editPiece(piece.id, { title, body })
    setEditing(false)
    onEdited()
  }
  return (
    <aside className="map-detail" aria-label="Piece">
      <p className="map-detail-when">
        {piece.day === today ? <span className="map-today">Today</span> : <span className="map-day">{dayLabel(piece.day)}</span>}
        <span>{fromWords(piece)}</span>
      </p>
      {editing ? (
        <form
          className="map-edit"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <textarea aria-label="What it says" rows={5} value={body} onChange={(event) => setBody(event.target.value)} />
          <div className="map-edit-actions">
            <button type="submit" className="outline-button small">
              Save
            </button>
            <button type="button" className="map-text" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <h2 className="map-detail-title">{piece.title}</h2>
          {piece.body && <p className="map-detail-body">{piece.body}</p>}
        </>
      )}
      {piece.source.url && (
        <button type="button" className="map-source" disabled={!canWrite} title={canWrite ? undefined : 'Open a project to put pages on a desk'} onClick={() => onOpenUrl(piece.source.url!)}>
          [{piece.source.label}] {piece.source.title} ↗
        </button>
      )}
      <section className="map-detail-lines" aria-label="Lines">
        <h3>{lines.length === 0 ? 'No lines yet' : fresh > 0 ? `${count(fresh, 'new line')}${lines.length > fresh ? `, ${lines.length - fresh} earlier` : ''}` : count(lines.length, 'line')}</h3>
        <ul>
          {sorted.map((line) => {
            const other = byId.get(line.from === piece.id ? line.to : line.from)
            if (!other) return null
            // "builds on" reads from the newer piece; seen from the older one, it is built on by the newer.
            const relation = line.from === piece.id ? line.relation : backwards(line.relation)
            return (
              <li key={line.id} data-fresh={line.drawnOn === today || undefined}>
                <span className="map-line-dot" aria-hidden />
                <button type="button" className="map-line-to" onClick={() => onSelect(other.id)}>
                  <span className="map-line-meta">
                    {relation} · {other.day === today ? 'Today' : dayLabel(other.day)}
                  </span>
                  <span>{other.title}</span>
                </button>
                <button type="button" className="map-line-remove" aria-label={`Remove the line to ${other.title}`} onClick={() => onRemoveLine(line.id)}>
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      </section>
      <p className="map-detail-note">Lines are drawn from what you read and asked. Remove any that don’t fit.</p>
      <div className="map-detail-actions">
        <button type="button" className="map-solid" disabled={!canWrite} title={canWrite ? undefined : 'Open a project to write notes'} onClick={onWriteMore}>
          Write more
        </button>
        {!editing && (
          <button type="button" className="outline-button" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        <button
          type="button"
          className="map-text"
          onClick={() =>
            void memory.removePiece(piece.id).then(onRemoved)
          }
        >
          Remove
        </button>
      </div>
    </aside>
  )
}

/** Something found that was never made into a piece: a page read, a chat. */
function FoundDetail({ found, canWrite, onOpenUrl, onClose }: { found: Recalled; canWrite: boolean; onOpenUrl(url: string): void; onClose(): void }) {
  return (
    <aside className="map-detail" aria-label="Found">
      <p className="map-detail-when">
        <span className="map-day">{dayLabel(found.day)}</span>
        <span>{found.label}, kept but not made into a piece</span>
      </p>
      <h2 className="map-detail-title">{found.title}</h2>
      {found.snippet && <p className="map-detail-body">{found.snippet}</p>}
      <div className="map-detail-actions">
        {found.url && (
          <button type="button" className="map-solid" disabled={!canWrite} onClick={() => onOpenUrl(found.url!)}>
            Open on a desk
          </button>
        )}
        <button type="button" className="outline-button" onClick={onClose}>
          Close
        </button>
      </div>
    </aside>
  )
}

/** Search by cues: finds pieces, and things never made into pieces. */
function MapSearch({ onPiece, onCapture }: { onPiece(hit: Recalled): void; onCapture(hit: Recalled): void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Recalled[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const asked = query.trim()
    if (!asked) {
      setHits([])
      return
    }
    let current = true
    const timer = setTimeout(() => {
      void memory.recall(asked).then((found) => {
        if (current) setHits(found)
      })
    }, 180)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query])
  const choose = (hit: Recalled): void => {
    setOpen(false)
    if (hit.type === 'piece') onPiece(hit)
    else onCapture(hit)
  }
  return (
    <div className="map-search">
      <input
        type="search"
        aria-label="Find anything"
        placeholder="Find anything, even unsaved: “that post on inference costs, Tuesday”"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setOpen(false)
          } else if (event.key === 'Enter' && hits[0]) choose(hits[0])
        }}
      />
      {open && query.trim() && (
        <ul className="map-hits" role="listbox" aria-label="Found">
          {hits.length === 0 && <li className="map-hits-none">Nothing found.</li>}
          {hits.slice(0, 8).map((hit) => (
            <li key={`${hit.type}:${hit.id}`} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => choose(hit)}>
                <span className="map-hit-meta">
                  {hit.label} · {dayLabel(hit.day)}
                  {hit.type === 'capture' && ' · not a piece'}
                </span>
                <span className="map-hit-title">{hit.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function newest(data: MapData): Piece | undefined {
  return data.pieces.filter((piece) => piece.day === data.today).at(-1)
}

/** "from a blog you read at 10:40", from where a piece came. */
function fromWords(piece: Piece): string {
  const at = timeLabel(piece.source.at)
  const { kind, label, url } = piece.source
  if (kind === 'chat') return `from a chat at ${at}`
  if (kind === 'screenshot') return `from a screenshot at ${at}`
  if (kind === 'selection' && !url) return `from words you kept at ${at}`
  const plain = ['Blog', 'Page', 'Paper', 'Video', 'Code'].includes(label)
  const name = plain ? label.toLowerCase() : label
  const article = /^[aeiou]/i.test(name) || /^X /.test(name) ? 'an' : 'a'
  return `from ${article} ${name} you ${label === 'Video' ? 'watched' : 'read'} at ${at}`
}

function backwards(relation: string): string {
  if (relation === 'builds on') return 'built on by'
  if (relation === 'why it matters') return 'matters because of'
  return relation
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
