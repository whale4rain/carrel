import { useState } from 'react'
import type { Frame } from '../shared/frame.js'
import { shortcutLabel } from '../shared/shortcuts.js'
import type { ItemView, ShellState } from '../shared/workspace-api.js'
import type { SideThread } from '../shared/agent-api.js'
import { BookIcon, ChevronIcon, LinkIcon, NoteIcon, SearchIcon, SparkIcon } from './icons.js'
import { initials } from './initials.js'
import type { Shelf } from './Library.js'
import { NameField } from './NameField.js'

export interface WorkspaceActions {
  openProject(name: string): Promise<void>
  createProject(name: string): Promise<void>
  openDesk(id: string): Promise<void>
  createDesk(name: string): Promise<void>
  createNote(): Promise<void>
  openNote(id: string): void
  /** Opens Search everything. */
  search(): void
  /** Opens the library at a shelf. */
  openLibrary(shelf: Shelf): void
  /** The keyboard shortcuts card. */
  openShortcuts(): void
  /** Opens the project thread (or a side thread, by id) beside the desk. */
  openThread(id?: string): void
}

interface Props {
  frame: Frame
  state: ShellState
  actions: WorkspaceActions
  items: readonly ItemView[]
  /** The project's side threads, newest first. */
  sides: readonly SideThread[]
  /** The thread open in the panel, if it is open. */
  thread: string | undefined
}

/** How many notes the sidebar lists by name, most recent first. */
const RECENT_NOTES = 5

/** One project, its desks, and the things the project owns. */
export function Sidebar({ frame, state, actions, items, sides, thread }: Props) {
  const notes = items.filter((item) => item.kind === 'note').sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  const count = (...kinds: Array<ItemView['kind']>): number => items.filter((item) => kinds.includes(item.kind)).length
  const open = state.open
  const [menu, setMenu] = useState(false)
  const [naming, setNaming] = useState<'project' | 'desk'>()
  // A tag picked under Notes: the list shows every note with it.
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

      {open && (
        <>
          <section className="group" aria-label="Desks">
            <h2>Desks</h2>
            {open.desks.map((desk) => (
              <button
                type="button"
                key={desk.id}
                className="row desk"
                aria-current={desk.id === open.desk ? 'page' : undefined}
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

          <section className="group" aria-label="Notes">
            <h2>Notes</h2>
            {(tag ? notes.filter((note) => note.tags?.includes(tag)) : notes.slice(0, RECENT_NOTES)).map((note) => (
              <button type="button" key={note.id} className="row note" onClick={() => actions.openNote(note.id)}>
                <NoteIcon />
                <span className="grow">{note.title}</span>
              </button>
            ))}
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
            <button type="button" className="row desk muted" onClick={() => void actions.createNote()}>
              + New note
            </button>
          </section>

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
