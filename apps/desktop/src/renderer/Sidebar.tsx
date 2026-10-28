import { useState } from 'react'
import type { Frame } from '../shared/frame.js'
import { shortcutLabel } from '../shared/shortcuts.js'
import type { ItemView, NoteViewSpec, ShellState } from '../shared/workspace-api.js'
import type { SideThread } from '../shared/agent-api.js'
import type { KeptToday } from '../shared/memory-api.js'
import { BookIcon, CalendarIcon, ChevronIcon, LinesIcon, LinkIcon, PinIcon, SearchIcon, SparkIcon, TableIcon } from './icons.js'
import { initials } from './initials.js'
import type { Shelf } from './Library.js'
import { NameField } from './NameField.js'
import { NotesTree, type NotesTreeActions } from './NotesTree.js'

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
  /** Opens the project thread (or a side thread, by id) beside the desk. */
  openThread(id?: string): void
  /** Opens the map of what you learned in place of the desk. */
  openMap(): void
}

interface Props {
  frame: Frame
  state: ShellState
  actions: WorkspaceActions
  items: readonly ItemView[]
  /** The project's note folders, empty ones too. */
  folders: readonly string[]
  /** The note open in the notes view, if one is. */
  note: string | undefined
  /** The project's saved views of notes, and the one open. */
  views: readonly NoteViewSpec[]
  view: string | undefined
  /** The project's side threads, newest first. */
  sides: readonly SideThread[]
  /** The thread open in the panel, if it is open. */
  thread: string | undefined
  /** The map is open. */
  map: boolean
  /** What was kept today, for the line under Map. */
  kept: KeptToday | undefined
}

/** One project, its desks, and the things the project owns. */
export function Sidebar({ frame, state, actions, items, folders, note, views, view, sides, thread, map, kept }: Props) {
  const notes = items.filter((item) => item.kind === 'note').sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  const count = (...kinds: Array<ItemView['kind']>): number => items.filter((item) => kinds.includes(item.kind)).length
  const open = state.open
  const [menu, setMenu] = useState(false)
  const [naming, setNaming] = useState<'project' | 'desk' | 'view'>()
  // A tag picked under Notes: the tree shows only the notes with it.
  const [tag, setTag] = useState<string>()
  const tags = [...new Set(notes.flatMap((note) => note.tags ?? []))].sort()

  return (
    <nav className="sidebar" aria-label="Project">
      {open ? (
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
              {naming === 'project' ? (
                <NameField
                  variant="inline"
                  label="New project name"
                  placeholder="Project name"
                  submit="Create"
                  onSubmit={async (name) => {
                    await actions.createProject(name)
                    setNaming(undefined)
                    setMenu(false)
                  }}
                  onCancel={() => setNaming(undefined)}
                />
              ) : (
                <button type="button" role="menuitem" className="row muted" onClick={() => setNaming('project')}>
                  + New project
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="no-project">No project yet</p>
      )}

      <button type="button" className="search" onClick={actions.search} disabled={!open}>
        <SearchIcon />
        <span>Search everything</span>
        <kbd>{shortcutLabel(frame, 'search')}</kbd>
      </button>

      <section className="group" aria-label="Memory">
        <button type="button" className="row tree-row" aria-label="Map of what you learned" aria-current={map ? 'page' : undefined} onClick={actions.openMap}>
          <LinesIcon />
          <span className="grow">Map</span>
        </button>
        {kept && <KeptLine kept={kept} />}
      </section>

      {open && (
        <>
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
            {naming === 'desk' ? (
              <NameField
                variant="inline"
                label="New desk name"
                placeholder="Desk name"
                submit="Create"
                onSubmit={async (name) => {
                  await actions.createDesk(name)
                  setNaming(undefined)
                }}
                onCancel={() => setNaming(undefined)}
              />
            ) : (
              <button type="button" className="row desk muted" onClick={() => setNaming('desk')}>
                + New desk
              </button>
            )}
          </section>

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
            {naming === 'view' ? (
              <NameField
                variant="inline"
                label="New view name"
                placeholder="View name"
                submit="Create"
                onSubmit={async (name) => {
                  await actions.createView(name)
                  setNaming(undefined)
                }}
                onCancel={() => setNaming(undefined)}
              />
            ) : (
              <button type="button" className="row desk muted" onClick={() => setNaming('view')}>
                + New view
              </button>
            )}
          </section>

          <NotesTree notes={tag ? notes.filter((note) => note.tags?.includes(tag)) : notes} folders={tag ? [] : folders} current={note} actions={actions} />
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

          <section className="group" aria-label="Conversations">
            <h2>Conversations</h2>
            <button type="button" className="row convo" data-current={thread === 'project' || undefined} onClick={() => actions.openThread()}>
              <span className="agent-seat" aria-hidden>
                a
              </span>
              <span className="grow">Project thread</span>
            </button>
            {sides.map((side) => (
              <button key={side.id} type="button" className="row convo side" data-current={thread === side.id || undefined} title={side.title} onClick={() => actions.openThread(side.id)}>
                <span className="side-mark" aria-hidden>
                  ↳
                </span>
                <span className="grow">{side.title}</span>
              </button>
            ))}
          </section>

          <section className="group" aria-label="Library">
            <h2>Library</h2>
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
        </>
      )}

      <footer className="sidebar-foot">
        <button type="button" className="row">
          All projects
        </button>
        <button type="button" className="row">
          Global library
        </button>
        <button type="button" className="row" onClick={actions.openShortcuts}>
          Keyboard shortcuts
          <kbd>{shortcutLabel(frame, 'shortcuts')}</kbd>
        </button>
      </footer>
    </nav>
  )
}

/** What was kept today, quietly: the newest thing kept on purpose, and counts. */
function KeptLine({ kept }: { kept: KeptToday }) {
  const counts = [kept.chats > 0 && plural(kept.chats, 'chat'), kept.visits > 0 && `${plural(kept.visits, 'page')} read`, kept.kept > 0 && `${kept.kept} kept`].filter(Boolean)
  if (counts.length === 0) return null
  return (
    <div className="kept-today" aria-label="Kept today">
      <h2>Kept today</h2>
      {kept.latest[0] && <span className="kept-today-latest">{kept.latest[0].title}</span>}
      <span>{counts.join(', ')}</span>
    </div>
  )
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
