import type { Frame } from '../shared/frame.js'
import { shortcutLabel } from '../shared/shortcuts.js'
import { SidebarIcon } from './icons.js'

interface Props {
  frame: Frame
  project: string | undefined
  desk: string | undefined
  /** What is open: a desk, or a note on its own page. */
  place?: 'desk' | 'note'
  /** Whether the agent's thread is open beside the desk. */
  agentOpen: boolean
  onAgent: () => void
  /** Whether the sidebar is shown. */
  sidebarOpen: boolean
  onSidebar: () => void
}

/** Where you are, and the agent one shortcut away. */
export function TopBar({ frame, project, desk, place = 'desk', agentOpen, onAgent, sidebarOpen, onSidebar }: Props) {
  return (
    <header className="topbar">
      <button
        type="button"
        className="sidebar-button"
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-pressed={sidebarOpen}
        title={`${sidebarOpen ? 'Hide' : 'Show'} sidebar (${shortcutLabel(frame, 'sidebar')})`}
        onClick={onSidebar}
      >
        <SidebarIcon />
      </button>
      {project && desk ? (
        <>
          <span className="crumb">{project} /</span>
          <h1 className="desk-name">{desk}</h1>
          <span className="crumb">{place}</span>
        </>
      ) : (
        <h1 className="desk-name">Carrel</h1>
      )}
      <span className="grow" />
      <button type="button" className="agent-button" aria-pressed={agentOpen} disabled={!project} onClick={onAgent}>
        Agent <kbd>{shortcutLabel(frame, 'agent')}</kbd>
      </button>
    </header>
  )
}
