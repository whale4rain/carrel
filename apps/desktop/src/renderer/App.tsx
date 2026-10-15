import { useEffect, useRef, useState } from 'react'
import { frameFor } from '../shared/frame.js'
import type { ItemView, SearchHitView, ShellState, ThatView } from '../shared/workspace-api.js'
import { Welcome } from './Desk.js'
import { AgentPanel } from './AgentPanel.js'
import { DeskPlane, type ShowRequest } from './DeskPlane.js'
import { SearchPalette } from './SearchPalette.js'
import { Sidebar, type WorkspaceActions } from './Sidebar.js'
import { TopBar } from './TopBar.js'
import './shell.css'

const frame = frameFor(window.carrel.platform, new URLSearchParams(location.search).get('frame') ?? undefined)
const api = window.carrel.workspace

export function App() {
  const [state, setState] = useState<ShellState>()
  const [items, setItems] = useState<ReadonlyMap<string, ItemView>>(new Map())
  // What the sidebar or search asked the desk to show.
  const [show, setShow] = useState<ShowRequest>()
  const [searching, setSearching] = useState(false)
  const [talking, setTalking] = useState(false)
  // The that.s you made since you last asked, which the agent's composer points at; and the desk in view.
  const [pointing, setPointing] = useState<ThatView[]>([])
  const deskContext = useRef<{ name: string; items: string[]; selected: string[] }>(undefined)

  // ⌘K / Ctrl+K searches and ⌘J / Ctrl+J opens the agent, from anywhere, even while writing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'k') setSearching((now) => !now)
      else if (key === 'j') setTalking((now) => !now)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    const offPage = window.carrel.web.onShortcut((key) => (key === 'k' ? setSearching : setTalking)((now) => !now))
    return () => {
      window.removeEventListener('keydown', onKey, true)
      offPage()
    }
  }, [])
  // A chip in an answer opens its spot, laying its source on the desk if it isn't there.
  const openThat = async (id: string): Promise<void> => {
    const that = (await api.thats()).find((known) => known.id === id)
    if (that) setShow({ itemId: that.itemId, nonce: Date.now(), that: that.id })
  }
  const openHit = (hit: SearchHitView): void => {
    const nonce = Date.now()
    if (hit.kind === 'that' && hit.itemId) setShow({ itemId: hit.itemId, nonce, that: hit.id })
    else if (hit.kind === 'page' && hit.itemId && hit.page !== undefined) setShow({ itemId: hit.itemId, nonce, page: hit.page })
    else setShow({ itemId: hit.id, nonce })
  }

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

  // A web page can rename its item once it loads.
  useEffect(() => window.carrel.web.onItem((item) => setItems((known) => new Map(known).set(item.id, item))), [])

  // Each action returns the new state from disk; errors reach the field that asked.
  const actions: WorkspaceActions = {
    openProject: async (name) => setState(await api.openProject(name)),
    createProject: async (name) => setState(await api.createProject(name)),
    openDesk: async (id) => setState(await api.openDesk(id)),
    createDesk: async (name) => setState(await api.createDesk(name)),
    createNote: async () => {
      const note = await api.createNote()
      addItems([note])
      setShow({ itemId: note.id, nonce: Date.now(), write: true })
    },
    openNote: (id) => setShow({ itemId: id, nonce: Date.now(), write: true }),
    search: () => setSearching(true),
    openThread: () => setTalking(true),
  }

  const open = state?.open
  const desk = open?.desks.find((entry) => entry.id === open.desk)

  return (
    <div className="shell" data-carrel-shell={state ? '' : undefined} data-frame={frame} data-agent={talking && open ? '' : undefined}>
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
          <TopBar frame={frame} project={open?.project} desk={desk?.name} agentOpen={talking} onAgent={() => setTalking((now) => !now)} />
          {open && desk ? <DeskPlane
              key={desk.id}
              deskId={desk.id}
              name={desk.name}
              items={items}
              onItemsAdded={addItems}
              show={show}
              onPointed={(that) => setPointing((now) => [...now.filter((other) => other.id !== that.id), that])}
              onContext={(context) => (deskContext.current = context)}
            /> : <Welcome onCreate={actions.createProject} />}
          {talking && open && (
            <AgentPanel
              key={open.project}
              project={open.project}
              pointing={pointing}
              context={() => ({ points: pointing.map((that) => that.id), ...(deskContext.current ? { desk: deskContext.current } : {}) })}
              onUnpoint={(id) => setPointing((now) => now.filter((that) => that.id !== id))}
              onAsked={() => setPointing([])}
              onOpenThat={(id) => void openThat(id)}
              onClose={() => setTalking(false)}
            />
          )}
          {searching && open && <SearchPalette items={items} onOpen={openHit} onClose={() => setSearching(false)} />}
        </>
      )}
    </div>
  )
}
