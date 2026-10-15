import { useEffect, useRef, useState } from 'react'
import { frameFor } from '../shared/frame.js'
import { PROJECT_THREAD, type SideThread } from '../shared/agent-api.js'
import type { ItemView, SearchHitView, ShellState, ThatView } from '../shared/workspace-api.js'
import { Welcome } from './Desk.js'
import { AgentPanel, NEW_SIDE } from './AgentPanel.js'
import { DeskPlane, type ShowRequest } from './DeskPlane.js'
import { NOTE_CHANGED } from './NoteView.js'
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
  const [focusTurn, setFocusTurn] = useState<{ id: string; nonce: number }>()
  // The thread the panel shows, and the project's side threads.
  const [threadId, setThreadId] = useState(PROJECT_THREAD)
  const [sides, setSides] = useState<SideThread[]>([])
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
    const offPage = window.carrel.web.onShortcut((key) => {
      if (key === 'k') setSearching((now) => !now)
      else if (key === 'j') setTalking((now) => !now)
    })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      offPage()
    }
  }, [])
  // A chip in an answer opens its spot, laying its source on the desk if it isn't there.
  const openThat = async (id: string): Promise<void> => {
    const that = (await api.thats()).find((known) => known.id === id)
    if (!that) return
    // A that. on a turn opens the thread there.
    const turn = that.itemId.startsWith('thread:') ? that.selectors.find((selector) => selector.type === 'FragmentSelector' && selector.value.startsWith('turn=')) : undefined
    if (turn?.type === 'FragmentSelector') {
      setThreadId(that.itemId.slice('thread:'.length))
      setTalking(true)
      setFocusTurn({ id: turn.value.slice('turn='.length), nonce: Date.now() })
    } else setShow({ itemId: that.itemId, nonce: Date.now(), that: that.id })
  }
  const openHit = (hit: SearchHitView): void => {
    const nonce = Date.now()
    if (hit.kind === 'that' && hit.itemId?.startsWith('thread:')) void openThat(hit.id)
    else if (hit.kind === 'that' && hit.itemId) setShow({ itemId: hit.itemId, nonce, that: hit.id })
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
    setThreadId(PROJECT_THREAD)
    void window.carrel.agent.sides().then((list) => current && setSides(list))
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
    openThread: (id = PROJECT_THREAD) => {
      setThreadId(id)
      setTalking(true)
    },
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
          <Sidebar frame={frame} state={state} actions={actions} items={[...items.values()]} sides={sides} thread={talking ? threadId : undefined} />
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
              key={`${open.project}/${threadId}`}
              project={open.project}
              threadId={threadId}
              sides={sides}
              onThread={(id) => {
                setThreadId(id)
                if (id !== NEW_SIDE && id !== PROJECT_THREAD && !sides.some((side) => side.id === id)) void window.carrel.agent.sides().then(setSides)
              }}
              pointing={pointing}
              context={() => ({ points: pointing.map((that) => that.id), ...(deskContext.current ? { desk: deskContext.current } : {}) })}
              onUnpoint={(id) => setPointing((now) => now.filter((that) => that.id !== id))}
              onAsked={() => setPointing([])}
              onOpenThat={(id) => void openThat(id)}
              onOpenItem={(id) => setShow({ itemId: id, nonce: Date.now() })}
              onAccepted={(item) => {
                addItems([item])
                // The desk stays as you left it; an open note shows what was added.
                if (item.kind === 'note') window.dispatchEvent(new CustomEvent(NOTE_CHANGED, { detail: item.id }))
              }}
              focusTurn={focusTurn}
              onAddToNote={async (turnId, thread) => {
                // The note selected on the desk, or a new one laid on the desk.
                const selected = deskContext.current?.selected.find((id) => items.get(id)?.kind === 'note')
                const note = await window.carrel.agent.addToNote(turnId, selected, thread)
                addItems([note])
                window.dispatchEvent(new CustomEvent(NOTE_CHANGED, { detail: note.id }))
                if (!selected) setShow({ itemId: note.id, nonce: Date.now() })
                return note
              }}
              onClose={() => setTalking(false)}
            />
          )}
          {searching && open && <SearchPalette items={items} onOpen={openHit} onClose={() => setSearching(false)} />}
        </>
      )}
    </div>
  )
}
