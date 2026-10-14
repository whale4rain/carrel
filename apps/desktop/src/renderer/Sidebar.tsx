import type { Frame } from '../shared/frame.js'
import { shortcut } from '../shared/frame.js'
import { BookIcon, ChevronIcon, LinkIcon, NoteIcon, SearchIcon, SparkIcon } from './icons.js'
import { initials, type ShellProject } from './sample.js'

interface Props {
  frame: Frame
  project: ShellProject
  openDesk: string
  onOpenDesk(desk: string): void
}

/** One project, its desks, and the things the project owns. */
export function Sidebar({ frame, project, openDesk, onOpenDesk }: Props) {
  return (
    <nav className="sidebar" aria-label="Project">
      <button type="button" className="project">
        <span className="project-mark">{initials(project.name)}</span>
        <span className="project-name">{project.name}</span>
        <ChevronIcon />
      </button>
      <button type="button" className="search">
        <SearchIcon />
        <span>Search everything</span>
        <kbd>{shortcut(frame, 'K')}</kbd>
      </button>

      <section className="group" aria-label="Desks">
        <h2>Desks</h2>
        {project.desks.map((desk) => (
          <button
            type="button"
            key={desk}
            className="row desk"
            aria-current={desk === openDesk ? 'page' : undefined}
            onClick={() => onOpenDesk(desk)}
          >
            {desk === openDesk && <span className="open-dot" aria-hidden />}
            {desk}
          </button>
        ))}
        <button type="button" className="row desk muted">
          + New desk
        </button>
      </section>

      <section className="group" aria-label="Notes">
        <h2>Notes</h2>
        {project.pinnedNotes.map((note) => (
          <button type="button" key={note} className="row">
            <NoteIcon />
            {note}
          </button>
        ))}
        <button type="button" className="row">
          <NoteIcon />
          <span className="grow">All notes</span>
          <span className="count">{project.noteCount}</span>
        </button>
        {project.tags.length > 0 && (
          <div className="tags">
            {project.tags.map((tag) => (
              <span key={tag} className="tag">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="group" aria-label="Conversations">
        <h2>Conversations</h2>
        <button type="button" className="row">
          <span className="agent-seat" aria-hidden>
            a
          </span>
          <span className="grow">Project thread</span>
          {project.unread > 0 && <span className="unread">{project.unread}</span>}
        </button>
        {project.sideThreads.map((thread) => (
          <button type="button" key={thread} className="row thread">
            {thread}
          </button>
        ))}
      </section>

      <section className="group" aria-label="Library">
        <h2>Library</h2>
        <button type="button" className="row">
          <BookIcon />
          <span className="grow">Books &amp; papers</span>
          <span className="count">{project.library.books}</span>
        </button>
        <button type="button" className="row">
          <LinkIcon />
          <span className="grow">Videos</span>
          <span className="count">{project.library.videos}</span>
        </button>
        <button type="button" className="row">
          <LinkIcon />
          <span className="grow">Web pages</span>
          <span className="count">{project.library.pages}</span>
        </button>
        <button type="button" className="row">
          <SparkIcon />
          <span className="grow">Made by the agent</span>
          <span className="count">{project.library.agent}</span>
        </button>
      </section>

      <footer className="sidebar-foot">
        <button type="button" className="row">
          All projects
        </button>
        <button type="button" className="row">
          Global library
        </button>
      </footer>
    </nav>
  )
}
