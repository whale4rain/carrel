import { useEffect, useState } from 'react'
import { frameFor } from '../shared/frame.js'
import type { ItemView, ShellState } from '../shared/workspace-api.js'
import { Welcome } from './Desk.js'
import { DeskPlane } from './DeskPlane.js'
import { Sidebar, type WorkspaceActions } from './Sidebar.js'
import { TopBar } from './TopBar.js'
import './shell.css'

const frame = frameFor(window.carrel.platform, new URLSearchParams(location.search).get('frame') ?? undefined)
const api = window.carrel.workspace

export function App() {
  const [state, setState] = useState<ShellState>()
  const [items, setItems] = useState<ReadonlyMap<string, ItemView>>(new Map())

  useEffect(() => {
    void api.state().then(setState)
  }, [])

  // The open project's sources, for the sidebar and the desk.
  const project = state?.open?.project
  useEffect(() => {
    if (project === undefined) return
    let current = true
    void api.items().then((list) => {
      if (current) setItems(new Map(list.map((item) => [item.id, item])))
    })
    return () => {
      current = false
    }
  }, [project])
  const addItems = (added: ItemView[]): void => setItems((known) => new Map([...known, ...added.map((item) => [item.id, item] as const)]))

  // Each action returns the new state from disk; errors reach the field that asked.
  const actions: WorkspaceActions = {
    openProject: async (name) => setState(await api.openProject(name)),
    createProject: async (name) => setState(await api.createProject(name)),
    openDesk: async (id) => setState(await api.openDesk(id)),
    createDesk: async (name) => setState(await api.createDesk(name)),
  }

  const open = state?.open
  const desk = open?.desks.find((entry) => entry.id === open.desk)

  return (
    <div className="shell" data-carrel-shell={state ? '' : undefined} data-frame={frame}>
      {frame === 'windows' && (
        <div className="titlestrip">
          <span className="titlestrip-mark">Carrel</span>
          {open && desk && (
            <span className="titlestrip-path">
              {open.project} · {desk.name}
            </span>
          )}
        </div>
      )}
      {state && (
        <>
          <Sidebar frame={frame} state={state} actions={actions} items={[...items.values()]} />
          <TopBar frame={frame} project={open?.project} desk={desk?.name} />
          {open && desk ? <DeskPlane key={desk.id} deskId={desk.id} name={desk.name} items={items} onItemsAdded={addItems} /> : <Welcome onCreate={actions.createProject} />}
        </>
      )}
    </div>
  )
}
