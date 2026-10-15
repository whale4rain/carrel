import { shortcut, type Frame } from '../shared/frame.js'

interface Props {
  frame: Frame
  project: string | undefined
  desk: string | undefined
  /** Whether the agent's thread is open beside the desk. */
  agentOpen: boolean
  onAgent: () => void
}

/** Where you are, and the agent one shortcut away. */
export function TopBar({ frame, project, desk, agentOpen, onAgent }: Props) {
  return (
    <header className="topbar">
      {project && desk ? (
        <>
          <span className="crumb">{project} /</span>
          <h1 className="desk-name">{desk}</h1>
          <span className="crumb">desk</span>
        </>
      ) : (
        <h1 className="desk-name">Carrel</h1>
      )}
      <span className="grow" />
      <button type="button" className="agent-button" aria-pressed={agentOpen} disabled={!project} onClick={onAgent}>
        Agent <kbd>{shortcut(frame, 'J')}</kbd>
      </button>
    </header>
  )
}
