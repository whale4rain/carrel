import { shortcut, type Frame } from '../shared/frame.js'

interface Props {
  frame: Frame
  project: string | undefined
  desk: string | undefined
}

/** Where you are, and the agent one shortcut away. */
export function TopBar({ frame, project, desk }: Props) {
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
      <button type="button" className="agent-button">
        Agent <kbd>{shortcut(frame, 'J')}</kbd>
      </button>
    </header>
  )
}
