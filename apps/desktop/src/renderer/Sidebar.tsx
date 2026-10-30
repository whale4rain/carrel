import { useState, type ReactNode } from 'react'
import type { Frame } from '../shared/frame.js'
import { shortcutLabel } from '../shared/shortcuts.js'
import type { ItemView, NoteViewSpec, ShellState } from '../shared/workspace-api.js'
import type { KeptToday } from '../shared/memory-api.js'
import { BookIcon, CalendarIcon, ChevronIcon, LinkIcon, PinIcon, PlaceIcon, SparkIcon, TableIcon } from './icons.js'
import { initials } from './initials.js'
import type { Shelf } from './Library.js'
import { NameField } from './NameField.js'
import { NotesTree, type NotesTreeActions } from './NotesTree.js'

/** The places on the rail. Each shows its own column; the agent is a place too. */
export type Place = 'map' | 'today' | 'desks' | 'notes' | 'sources'

const PLACES: ReadonlyArray<{ id: Place; label: string; name: string }> = [
  { id: 'map', label: 'Map', name: 'Map of what you learned' },
  { id: 'today', label: 'Today', name: 'Today' },
  { id: 'desks', label: 'Desks', name: 'Desks' },
  { id: 'notes', label: 'Notes', name: 'Notes' },
  { id: 'sources', label: 'Sources', name: 'Sources' },
]

export interface WorkspaceActions extends NotesTreeActions {
  openProject(name: string): Promise<void>
  createProject(name: string): Promise<void>
  openDesk(id: string): Promise<void>
  createDesk(name: string): Promise<void>
  /** Opens a saved view of notes in place of the desk. */
  openView(id: string): void
  createView(name: string): Promise<void>
  /** Opens today's note, made if it isn't there yet. */
  dailyNote(): Promise<void>
  /** Opens Search everything. */
  search(): void
  /** Opens the library at a shelf. */
  openLibrary(shelf: Shelf): void
  /** The keyboard shortcuts card. */
  openShortcuts(): void
  /** Memory's settings: the reading trail, chats, imports. */
  openMemorySettings(): void
  /** Opens the Keep window, as ⌘⇧K does. */
  keep(): void
  /** Opens the project thread (or a side thread, by id) beside the desk. */
  openThread(id?: string): void
  /** Opens or closes the agent beside what is open. */
  toggleAgent(): void
  /** Goes to a place on the rail. */
  openPlace(place: Place): void
}

interface Props {
  frame: Frame
  state: ShellState
  actions: WorkspaceActions
  /** The place picked on the rail; its column shows beside the rail unless folded. */
  place: Place
  /** The column is folded away (⌘\ / Ctrl+\); the rail stays. */
  folded: boolean
  items: readonly ItemView[]
  /** The project's note folders, empty ones too. */
  folders: readonly string[]
  /** The note open in the notes view, if one is. */
  note: string | undefined
  /** The project's saved views of notes, and the one open. */
  views: readonly NoteViewSpec[]
  view: string | undefined
  /** The agent is open. */
  talking: boolean
  /** The map is open. */
  map: boolean
  /** What was kept today. */
  kept: KeptToday | undefined
}

/** The rail of places, and beside it the column of the place you picked. */
export function Sidebar(props: Props) {
  const { frame, actions, place, folded, talking } = props
  return (
    <div className="sidebar" data-folded={folded || undefined}>
      <nav className="rail" aria-label="Places">
        {PLACES.map((entry) => (
          <button
            type="button"
            key={entry.id}
            className="rail-place"
            aria-label={entry.name}
            aria-current={entry.id === place ? 'page' : undefined}
            title={entry.label}
            onClick={() => actions.openPlace(entry.id)}
          >
            <PlaceIcon place={entry.id} />
            <span aria-hidden>{entry.label}</span>
          </button>
        ))}
        <span className="rail-rule" aria-hidden />
        <button
          type="button"
          className="rail-place rail-agent"
          aria-label="Agent"
          aria-pressed={talking}
          disabled={!props.state.open}
          title={`Agent (${shortcutLabel(frame, 'agent')})`}
          onClick={actions.toggleAgent}
        >
          <span className="agent-seat rail-seat" aria-hidden>
            a
          </span>
          <span aria-hidden>Agent</span>
        </button>
        <span className="grow" />
        <button type="button" className="rail-tool" aria-label="Search everything" title={`Search everything (${shortcutLabel(frame, 'search')})`} disabled={!props.state.open} onClick={actions.search}>
          <PlaceIcon place="search" />
        </button>
        <button type="button" className="rail-tool" aria-label="Keyboard shortcuts" title={`Keyboard shortcuts (${shortcutLabel(frame, 'shortcuts')})`} onClick={actions.openShortcuts}>
          <PlaceIcon place="keys" />
        </button>
        <button type="button" className="rail-tool" aria-label="Memory settings" title="Memory settings" onClick={actions.openMemorySettings}>
          <PlaceIcon place="settings" />
        </button>
      </nav>
      {!folded && (
        <nav className="place-column" aria-label="Sidebar">
          <Column {...props} />
        </nav>
      )}
    </div>
  )
}

function Column(props: Props) {
  switch (props.place) {
    case 'map':
      return <MapColumn {...props} />
    case 'today':
      return <TodayColumn {...props} />
    case 'desks':
      return (
        <ProjectColumn {...props}>
          <DesksGroup {...props} />
        </ProjectColumn>
      )
    case 'notes':
      return (
        <ProjectColumn {...props}>
          <NotesGroups {...props} />
        </ProjectColumn>
      )
    case 'sources':
      return (
        <ProjectColumn {...props}>
          <SourcesGroup {...props} />
        </ProjectColumn>
      )
  }
}

/** The map: what was kept today, and a way to keep more. */
function MapColumn({ frame, actions, kept }: Props) {
  return (
    <>
      <h2 className="column-title">Map</h2>
      {kept && <KeptLine kept={kept} />}
      <span className="grow" />
      <button type="button" className="row" onClick={actions.keep}>
        <span className="grow">Keep something</span>
        <kbd>{shortcutLabel(frame, 'keep')}</kbd>
      </button>
      <p className="column-hint">Everything you read and ask is kept. Each evening Carrel draws lines between days.</p>
    </>
  )
}

/** Today: today's note and what you kept today. */
function TodayColumn({ frame, actions, state, kept }: Props) {
  const counts = kept ? keptCounts(kept) : []
  return (
    <>
      <h2 className="column-title">Today</h2>
      {state.open && (
        <button type="button" className="row tree-row" onClick={() => void actions.dailyNote()}>
          <CalendarIcon />
          <span className="grow">Today’s note</span>
          <kbd>{shortcutLabel(frame, 'daily')}</kbd>
        </button>
      )}
      <section className="group" aria-label="Kept today">
        <h2>Kept today</h2>
        {kept && kept.latest.length > 0 ? (
          kept.latest.map((entry, index) => (
            <span key={index} className="row kept-row">
              <span className="count">{entry.kind}</span>
              <span className="grow">{entry.title}</span>
            </span>
          ))
        ) : (
          <p className="column-hint">Nothing kept on purpose yet today.</p>
        )}
        {counts.length > 0 && <p className="column-hint">{counts.join(', ')}</p>}
      </section>
      <span className="grow" />
      <button type="button" className="row" onClick={actions.keep}>
        <span className="grow">Keep something</span>
        <kbd>{shortcutLabel(frame, 'keep')}</kbd>
      </button>
    </>
  )
}

/** A project's place: the switcher on top, then what the place lists. */
function ProjectColumn({ state, actions, children }: Props & { children: ReactNode }) {
  const open = state.open
  const [menu, setMenu] = useState(false)
  const [naming, setNaming] = useState(false)
  if (!open) return <p className="no-project">No project yet</p>
  return (
    <>
      <div className="project-switcher">
        <button type="button" className="project" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <span className="project-mark">{initials(open.project)}</span>
          <span className="project-name">{open.project}</span>
          <ChevronIcon />
        </button>
        {menu && (
          <div className="project-menu" role="menu">
            {state.projects.map((name) => (
              <button
                type="button"
                role="menuitem"
                key={name}
                className="row"
                aria-current={name === open.project ? 'true' : undefined}
                onClick={() => {
                  setMenu(false)
                  void actions.openProject(name)
                }}
              >
                <span className="project-mark small">{initials(name)}</span>
                {name}
              </button>
            ))}
            {naming ? (
              <NameField
                variant="inline"
                label="New project name"
                placeholder="Project name"
                submit="Create"
                onSubmit={async (name) => {
                  await actions.createProject(name)
                  setNaming(false)
                  setMenu(false)
                }}
                onCancel={() => setNaming(false)}
              />
            ) : (
              <button type="button" role="menuitem" className="row muted" onClick={() => setNaming(true)}>
                + New project
              </button>
            )}
          </div>
        )}
      </div>
      {children}
    </>
  )
}

function DesksGroup({ state, actions, note, view, map }: Props) {
  const open = state.open!
  const [naming, setNaming] = useState(false)
  return (
    <section className="group" aria-label="Desks">
      <h2>Desks</h2>
      {open.desks.map((desk) => (
        <button
          type="button"
          key={desk.id}
          className="row desk"
          aria-current={desk.id === open.desk && note === undefined && view === undefined && !map ? 'page' : undefined}
          onClick={() => void actions.openDesk(desk.id)}
        >
          {desk.id === open.desk && <span className="open-dot" aria-hidden />}
          {desk.name}
        </button>
      ))}
      {naming ? (
        <NameField
          variant="inline"
          label="New desk name"
          placeholder="Desk name"
          submit="Create"
          onSubmit={async (name) => {
            await actions.createDesk(name)
            setNaming(false)
          }}
          onCancel={() => setNaming(false)}
        />
      ) : (
        <button type="button" className="row desk muted" onClick={() => setNaming(true)}>
          + New desk
        </button>
      )}
    </section>
  )
}

function NotesGroups({ frame, actions, items, folders, note, views, view }: Props) {
  const notes = items.filter((item) => item.kind === 'note').sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  const [naming, setNaming] = useState(false)
  // A tag picked under Notes: the tree shows only the notes with it.
  const [tag, setTag] = useState<string>()
  const tags = [...new Set(notes.flatMap((entry) => entry.tags ?? []))].sort()
  return (
    <>
      <section className="group" aria-label="Pinned">
        <h2>Pinned</h2>
        {notes
          .filter((entry) => entry.pinned)
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((entry) => (
            <button type="button" key={entry.id} className="row note tree-row" aria-current={entry.id === note ? 'page' : undefined} onClick={() => actions.openNote(entry.id)}>
              <PinIcon />
              <span className="grow">{entry.title}</span>
            </button>
          ))}
        <button type="button" className="row tree-row" onClick={() => void actions.dailyNote()}>
          <CalendarIcon />
          <span className="grow">Today’s note</span>
          <kbd>{shortcutLabel(frame, 'daily')}</kbd>
        </button>
      </section>

      <section className="group" aria-label="Views">
        <h2>Views</h2>
        {views.map((entry) => (
          <button type="button" key={entry.id} className="row tree-row" aria-current={entry.id === view ? 'page' : undefined} onClick={() => actions.openView(entry.id)}>
            <TableIcon />
            <span className="grow">{entry.name}</span>
          </button>
        ))}
        {naming ? (
          <NameField
            variant="inline"
            label="New view name"
            placeholder="View name"
            submit="Create"
            onSubmit={async (name) => {
              await actions.createView(name)
              setNaming(false)
            }}
            onCancel={() => setNaming(false)}
          />
        ) : (
          <button type="button" className="row desk muted" onClick={() => setNaming(true)}>
            + New view
          </button>
        )}
      </section>

      <NotesTree notes={tag ? notes.filter((entry) => entry.tags?.includes(tag)) : notes} folders={tag ? [] : folders} current={note} actions={actions} />
      <div className="notes-more">
        <button type="button" className="row" onClick={() => actions.openLibrary('notes')}>
          <span className="grow indent">All notes</span>
          <span className="count">{notes.length}</span>
        </button>
        {tags.length > 0 && (
          <div className="tags" aria-label="Tags">
            {tags.map((name) => (
              <button type="button" key={name} className="tag" aria-pressed={tag === name} onClick={() => setTag(tag === name ? undefined : name)}>
                #{name}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function SourcesGroup({ actions, items }: Props) {
  const count = (...kinds: Array<ItemView['kind']>): number => items.filter((item) => kinds.includes(item.kind)).length
  return (
    <section className="group" aria-label="Library">
      <h2>Sources</h2>
      <button type="button" className="row" onClick={() => actions.openLibrary('books')}>
        <BookIcon />
        <span className="grow">Books &amp; papers</span>
        <span className="count">{count('book', 'paper')}</span>
      </button>
      <button type="button" className="row" onClick={() => actions.openLibrary('videos')}>
        <LinkIcon />
        <span className="grow">Videos</span>
        <span className="count">{count('video')}</span>
      </button>
      <button type="button" className="row" onClick={() => actions.openLibrary('web')}>
        <LinkIcon />
        <span className="grow">Web pages</span>
        <span className="count">{count('web_page')}</span>
      </button>
      <button type="button" className="row" onClick={() => actions.openLibrary('agent')}>
        <SparkIcon />
        <span className="grow">Made by the agent</span>
        <span className="count">{items.filter((item) => item.createdBy === 'agent').length}</span>
      </button>
    </section>
  )
}

/** What was kept today, quietly: the newest thing kept on purpose, and counts. */
function KeptLine({ kept }: { kept: KeptToday }) {
  const counts = keptCounts(kept)
  if (counts.length === 0) return null
  return (
    <div className="kept-today" aria-label="Kept today">
      <h2>Kept today</h2>
      {kept.latest[0] && <span className="kept-today-latest">{kept.latest[0].title}</span>}
      <span>{counts.join(', ')}</span>
    </div>
  )
}

function keptCounts(kept: KeptToday): string[] {
  return [kept.chats > 0 && plural(kept.chats, 'chat'), kept.visits > 0 && `${plural(kept.visits, 'page')} read`, kept.kept > 0 && `${kept.kept} kept`].filter((entry): entry is string => Boolean(entry))
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
