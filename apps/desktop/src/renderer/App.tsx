import { useState } from 'react'
import { frameFor } from '../shared/frame.js'
import { Desk } from './Desk.js'
import { sampleProject } from './sample.js'
import { Sidebar } from './Sidebar.js'
import { TopBar } from './TopBar.js'
import './shell.css'

const frame = frameFor(window.carrel.platform, new URLSearchParams(location.search).get('frame') ?? undefined)

export function App() {
  const project = sampleProject
  const [openDesk, setOpenDesk] = useState(project.desks[0] ?? '')
  return (
    <div className="shell" data-carrel-shell data-frame={frame}>
      {frame === 'windows' && (
        <div className="titlestrip">
          <span className="titlestrip-mark">Carrel</span>
          <span className="titlestrip-path">
            {project.name} · {openDesk}
          </span>
        </div>
      )}
      <Sidebar frame={frame} project={project} openDesk={openDesk} onOpenDesk={setOpenDesk} />
      <TopBar frame={frame} project={project.name} desk={openDesk} />
      <Desk name={openDesk} />
    </div>
  )
}
