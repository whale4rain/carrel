import { useEffect, useRef, useState } from 'react'
import { PROJECT_THREAD, type SideThread } from '../shared/agent-api.js'
import type { AgentAsk } from '../shared/menu.js'
import { fromMarkdown } from '@carrel/core/note-markdown'
import type { KeptToday, Piece } from '../shared/memory-api.js'
import type { ItemView, NoteViewSpec, PropertyValue, SearchHitView, ShellState, ThatView } from '../shared/workspace-api.js'
import { Welcome } from './Desk.js'
import { AgentPanel, NEW_SIDE } from './AgentPanel.js'
import { DeskPlane, type ShowRequest } from './DeskPlane.js'
import { linkName, NOTE_CHANGED, resolveLink } from './NoteView.js'
import { Library, type Shelf } from './Library.js'
import { NotePage } from './NotePage.js'
import { NotesView } from './NotesView.js'
import { QuickOpen } from './QuickOpen.js'
import { SearchPalette } from './SearchPalette.js'
import { Sidebar, type Place, type WorkspaceActions } from './Sidebar.js'
import { TopBar } from './TopBar.js'
import { ShortcutSheet } from './ShortcutSheet.js'
import { MapView } from './MapView.js'
import { MemorySettings } from './MemorySettings.js'
import { DESK_COMMAND, frame } from './platform.js'
import './shell.css'
import './memory.css'
import './map.css'

const api = window.carrel.workspace

export function App() {
  const [state, setState] = useState<ShellState>()
  const [items, setItems] = useState<ReadonlyMap<string, ItemView>>(new Map())
  // What the sidebar or search asked the desk to show.
  const [show, setShow] = useState<ShowRequest>()
  // The note open on its own page, in place of the desk; `write` puts the cursor in it.
  const [page, setPage] = useState<{ note: string; write: boolean }>()
  const [folders, setFolders] = useState<string[]>([])
  // The project's saved views of notes, and the one open in place of the desk.
  const [views, setViews] = useState<NoteViewSpec[]>([])
  const [viewId, setViewId] = useState<string>()
  // The map of what you learned, open in place of the desk; and what was kept today, for the sidebar.
  const [map, setMap] = useState(false)
  const [kept, setKept] = useState<KeptToday>()
  // The place picked on the rail. The map is the start page once it has pieces on it.
  const [place, setPlace] = useState<Place>('desks')
  // Anything opened before the map answers (a place, desk, note or view) wins over the start page.
  const placePicked = useRef(false)
  useEffect(() => {
    void window.carrel.memory.map('2w').then(
      (data) => {
        if (data.pieces.length === 0 || placePicked.current) return
        setMap(true)
        setPlace('map')
      },
      () => undefined,
    )
  }, [])
  // Leaving the map for a desk, a note or a view leaves its place too.
  useEffect(() => {
    if (!map) setPlace((now) => (now === 'map' ? 'desks' : now))
  }, [map])
  useEffect(() => {
    const read = (): void => void window.carrel.memory.today().then(setKept, () => undefined)
    read()
    return window.carrel.memory.onKept(read)
  }, [])
  const openPage = (note: string, write = false): void => {
    placePicked.current = true
    setMap(false)
    setShow(undefined)
    setViewId(undefined)
    setPage({ note, write })
  }
  // Something to show on the desk brings the desk back.
  const showOnDesk = (request: ShowRequest): void => {
    placePicked.current = true
    setMap(false)
    setPage(undefined)
    setViewId(undefined)
    setShow(request)
  }
  const [focusTurn, setFocusTurn] = useState<{ id: string; nonce: number }>()
  // The thread the panel shows, and the project's side threads.
  const [threadId, setThreadId] = useState(PROJECT_THREAD)
  const [sides, setSides] = useState<SideThread[]>([])
  const [searching, setSearching] = useState(false)
  const [opening, setOpening] = useState(false)
  // The menu's and keys' Today's note, which needs the latest actions.
  const dailyRef = useRef<() => void>(() => undefined)
  const [talking, setTalking] = useState(false)
  const [keys, setKeys] = useState(false)
  // Memory's settings, opened from the menu bar; `importAsk` starts the ChatGPT import at once.
  const [memorySettings, setMemorySettings] = useState<{ importAsk?: number }>()
  // The sidebar folds away (⌘\ / Ctrl+\); remembered on this computer.
  const [sidebar, setSidebar] = useState(() => {
    try {
      return localStorage.getItem('carrel.sidebar') !== 'hidden'
    } catch {
      return true
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('carrel.sidebar', sidebar ? 'shown' : 'hidden')
    } catch {
      // Not remembered; it still works.
    }
  }, [sidebar])
  // The library's open shelf, if it is open.
  const [library, setLibrary] = useState<Shelf>()
  // The that.s you made since you last asked, which the agent's composer points at; and the desk in view.
  const [pointing, setPointing] = useState<ThatView[]>([])
  const deskContext = useRef<{ name: string; items: string[]; selected: string[] }>(undefined)
  // Words for the agent's composer from a right-click: sent at once, or left for you to finish.
  const [prompt, setPrompt] = useState<{ text: string; send: boolean; nonce: number }>()
  const askAgent = (ask: AgentAsk, that?: ThatView): void => {
    if (that) setPointing((now) => [...now.filter((other) => other.id !== that.id), that])
    setTalking(true)
    const nonce = Date.now()
    if (ask.kind === 'explain') setPrompt({ text: 'Explain this: what it says, in plain words, and how it fits the rest of the source.', send: true, nonce })
    else if (ask.kind === 'rewrite') setPrompt({ text: `In the note "${ask.note}", rewrite this: "${ask.quote}"\n\n`, send: false, nonce })
    else setPrompt({ text: ask.quote && ask.note ? `About this in the note "${ask.note}": "${ask.quote}"\n\n` : '', send: false, nonce })
  }
  useEffect(() => window.carrel.web.onAsk((ask, that) => askAgent(ask, that)), [])

  // ⌘K / Ctrl+K searches, ⌘J / Ctrl+J opens the agent, ⌘\\ folds the sidebar and ⌘/ lists
  // the shortcuts, from anywhere, even while writing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (event.shiftKey ? !(key === 'd' && run('daily')) : !run(key)) return
      event.preventDefault()
    }
    // The same keys from a live web page, and the menu bar's commands.
    const run = (key: string): boolean => {
      if (key === 'k' || key === 'search') setSearching((now) => !now)
      else if (key === 'j' || key === 'agent') setTalking((now) => !now)
      else if (key === '\\' || key === 'sidebar') setSidebar((now) => !now)
      else if (key === '/' || key === 'shortcuts') setKeys((now) => !now)
      else if (key === 'o' || key === 'open-note') setOpening((now) => !now)
      else if (key === 'daily') dailyRef.current()
      else if (key === 'keep') void window.carrel.memory.openKeep()
      else if (key === 'memory-settings') setMemorySettings((now) => now ?? {})
      // Each import command starts an import, open dialog or not.
      else if (key === 'import-chatgpt') setMemorySettings({ importAsk: Date.now() })
      else return false
      return true
    }
    window.addEventListener('keydown', onKey, true)
    const offPage = window.carrel.web.onShortcut((key) => void run(key))
    const offMenu = window.carrel.onCommand((id) => {
      if (!run(id)) window.dispatchEvent(new CustomEvent(DESK_COMMAND, { detail: id }))
    })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      offPage()
      offMenu()
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
    } else showOnDesk({ itemId: that.itemId, nonce: Date.now(), that: that.id })
  }
  const openHit = (hit: SearchHitView): void => {
    const nonce = Date.now()
    if (hit.kind === 'that' && hit.itemId?.startsWith('thread:')) void openThat(hit.id)
    else if (hit.kind === 'that' && hit.itemId) showOnDesk({ itemId: hit.itemId, nonce, that: hit.id })
    else if (hit.kind === 'page' && hit.itemId && hit.page !== undefined) showOnDesk({ itemId: hit.itemId, nonce, page: hit.page })
    else openItem(hit.id)
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
    setPage(undefined)
    setViewId(undefined)
    void api.noteViews().then((list) => current && setViews(list))
    void api.items().then((list) => {
      if (current) setItems(new Map(list.map((item) => [item.id, item])))
    })
    void api.noteFolders().then((list) => current && setFolders(list))
    return () => {
      current = false
    }
  }, [project])
  // A note opens on its own page; a source on the desk.
  const openItem = (id: string): void => {
    if (items.get(id)?.kind === 'note') openPage(id)
    else showOnDesk({ itemId: id, nonce: Date.now() })
  }
  // A [[link]] opens the note it names, or makes it when there is none yet.
  const openLink = async (target: string): Promise<void> => {
    const found = resolveLink(target, items.values())
    if (found) return openPage(found.id)
    const made = await api.createNote('', linkName(target))
    addItems([made])
    openPage(made.id, true)
  }
  const itemsRef = useRef(items)
  itemsRef.current = items
  const addItems = (added: ItemView[]): void => {
    // A renamed note had its links pointed at its new name in main: notes open elsewhere read theirs again.
    for (const item of added) {
      const before = itemsRef.current.get(item.id)
      if (item.kind !== 'note' || !before?.name || before.name === item.name) continue
      const old = before.name.toLowerCase()
      const linking = [...itemsRef.current.values()].filter((other) => other.id !== item.id && other.links?.some((link) => link.toLowerCase() === old))
      if (linking.length === 0) continue
      void api.items().then((list) => {
        setItems(new Map(list.map((known) => [known.id, known])))
        for (const other of linking) window.dispatchEvent(new CustomEvent(NOTE_CHANGED, { detail: other.id }))
      })
    }
    setItems((known) => new Map([...known, ...added.map((item) => [item.id, item] as const)]))
  }

  // A web page can rename its item once it loads.
  useEffect(() => window.carrel.web.onItem((item) => setItems((known) => new Map(known).set(item.id, item))), [])

  // Each action returns the new state from disk; errors reach the field that asked.
  const actions: WorkspaceActions = {
    openProject: async (name) => setState(await api.openProject(name)),
    createProject: async (name) => setState(await api.createProject(name)),
    openDesk: async (id) => {
      placePicked.current = true
      setMap(false)
      setPage(undefined)
      setViewId(undefined)
      setState(await api.openDesk(id))
    },
    createDesk: async (name) => setState(await api.createDesk(name)),
    createNote: async (folder) => {
      const note = await api.createNote(folder)
      addItems([note])
      openPage(note.id, true)
    },
    openNote: (id) => openPage(id),
    dailyNote: async () => {
      const today = await api.dailyNote()
      addItems([today])
      openPage(today.id, true)
    },
    createFolder: async (path) => {
      await api.createFolder(path)
      setFolders(await api.noteFolders())
    },
    renameFolder: async (from, to) => {
      await api.renameFolder(from, to)
      const [list, inside] = await Promise.all([api.items(), api.noteFolders()])
      setItems(new Map(list.map((item) => [item.id, item])))
      setFolders(inside)
    },
    moveNote: async (id, folder) => {
      addItems([await api.moveNote(id, folder)])
    },
    openView: (id) => {
      placePicked.current = true
      setMap(false)
      setPage(undefined)
      setViewId(id)
    },
    createView: async (name) => {
      const made = await api.createView(name)
      setViews((known) => [...known, made])
      placePicked.current = true
      setMap(false)
      setPage(undefined)
      setViewId(made.id)
    },
    search: () => setSearching(true),
    openLibrary: (shelf) => setLibrary(shelf),
    openShortcuts: () => setKeys(true),
    openThread: (id = PROJECT_THREAD) => {
      setThreadId(id)
      setTalking(true)
    },
    openMemorySettings: () => setMemorySettings((now) => now ?? {}),
    keep: () => void window.carrel.memory.openKeep(),
    toggleAgent: () => setTalking((now) => !now),
    openPlace: (next) => {
      placePicked.current = true
      setSidebar(true)
      setPlace(next)
      if (next === 'map') setMap(true)
      // Desks brings the open desk back from the map, a note or a view.
      else if (next === 'desks' && (map || page || viewId)) {
        setMap(false)
        setPage(undefined)
        setViewId(undefined)
      }
    },
  }
  // A piece becomes a note: its words, and where it came from.
  const writeMore = async (piece: Piece): Promise<void> => {
    const made = await api.createNote('', piece.title)
    const from = piece.source.url ? `From [${piece.source.title}](${piece.source.url}).` : `From ${piece.source.title}.`
    const saved = await api.saveNote(made.id, fromMarkdown(`${piece.body}\n\n${from}\n\n`))
    addItems([saved])
    openPage(saved.id, true)
  }
  const openUrl = async (url: string): Promise<void> => {
    const item = await api.addLink(url)
    addItems([item])
    showOnDesk({ itemId: item.id, nonce: Date.now() })
  }

  dailyRef.current = () => {
    if (state?.open) void actions.dailyNote()
  }

  const open = state?.open
  const desk = open?.desks.find((entry) => entry.id === open.desk)
  const note = page ? items.get(page.note) : undefined
  const view = note ? undefined : views.find((known) => known.id === viewId)
  const setProperty = async (id: string, key: string, value: PropertyValue | null): Promise<void> => addItems([await api.setProperty(id, key, value)])

  return (
    <div className="shell" data-carrel-shell={state ? '' : undefined} data-frame={frame} data-agent={talking && open ? '' : undefined} data-sidebar={sidebar ? undefined : 'hidden'}>
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
          <Sidebar frame={frame} state={state} actions={actions} place={place} folded={!sidebar} items={[...items.values()]} folders={folders} note={note?.id} views={views} view={view?.id} talking={talking && open !== undefined} map={map} kept={kept} />
          <TopBar frame={frame} project={open?.project} desk={note ? note.title : view ? view.name : desk?.name} place={map ? 'map' : note ? 'note' : view ? 'view' : 'desk'} agentOpen={talking} onAgent={() => setTalking((now) => !now)} sidebarOpen={sidebar} onSidebar={() => setSidebar((now) => !now)} />
          {map ? (
            <MapView frame={frame} canWrite={open !== undefined} onWriteMore={(piece) => void writeMore(piece)} onOpenUrl={(url) => void openUrl(url)} />
          ) : open && note ? (
            <NotePage
              note={note}
              items={items}
              write={page?.write === true}
              onSaved={(saved) => addItems([saved])}
              onOpenThat={(id) => void openThat(id)}
              onOpenItem={openItem}
              onPutOnDesk={() => showOnDesk({ itemId: note.id, nonce: Date.now() })}
              onProperty={(key, value) => setProperty(note.id, key, value)}
              onPin={(pinned) => void api.pinNote(note.id, pinned).then((saved) => addItems([saved]))}
              onOpenLink={(target) => void openLink(target)}
              onLinked={(linked) => {
                addItems([linked])
                window.dispatchEvent(new CustomEvent(NOTE_CHANGED, { detail: linked.id }))
              }}
            />
          ) : open && view ? (
            <NotesView
              key={view.id}
              view={view}
              items={items}
              onSave={(next) => {
                setViews((known) => known.map((other) => (other.id === next.id ? next : other)))
                void api.saveView(next).then((saved) => setViews((known) => known.map((other) => (other.id === saved.id ? saved : other))))
              }}
              onDelete={() => {
                void api.deleteView(view.id)
                setViews((known) => known.filter((other) => other.id !== view.id))
                setViewId(undefined)
              }}
              onOpenNote={(id) => openPage(id)}
              onProperty={setProperty}
              onCreateNote={(folder, properties) =>
                void (async () => {
                  let made = await api.createNote(folder)
                  for (const [key, value] of Object.entries(properties)) made = await api.setProperty(made.id, key, value)
                  addItems([made])
                  openPage(made.id, true)
                })()
              }
            />
          ) : open && desk ? <DeskPlane
              key={desk.id}
              deskId={desk.id}
              name={desk.name}
              items={items}
              onItemsAdded={addItems}
              show={show}
              onPointed={(that) => setPointing((now) => [...now.filter((other) => other.id !== that.id), that])}
              onContext={(context) => (deskContext.current = context)}
              onAsk={askAgent}
              onOpenLink={(target) => void openLink(target)}
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
              onOpenItem={openItem}
              onAccepted={(item) => {
                addItems([item])
                // The desk stays as you left it; an open note shows what was added.
                if (item.kind === 'note') window.dispatchEvent(new CustomEvent(NOTE_CHANGED, { detail: item.id }))
              }}
              focusTurn={focusTurn}
              prompt={prompt}
              onAddToNote={async (turnId, thread) => {
                // The note selected on the desk, or a new one laid on the desk.
                const selected = note?.id ?? deskContext.current?.selected.find((id) => items.get(id)?.kind === 'note')
                const added = await window.carrel.agent.addToNote(turnId, selected, thread)
                addItems([added])
                window.dispatchEvent(new CustomEvent(NOTE_CHANGED, { detail: added.id }))
                if (!selected) showOnDesk({ itemId: added.id, nonce: Date.now() })
                return added
              }}
              onClose={() => setTalking(false)}
            />
          )}
          {library && open && (
            <Library
              items={items}
              shelf={library}
              onDesk={new Set(deskContext.current?.items ?? [])}
              onOpen={(item) => {
                setLibrary(undefined)
                openItem(item.id)
              }}
              onClose={() => setLibrary(undefined)}
            />
          )}
          {keys && <ShortcutSheet onClose={() => setKeys(false)} />}
          {memorySettings && <MemorySettings {...(memorySettings.importAsk ? { importAsk: memorySettings.importAsk } : {})} onClose={() => setMemorySettings(undefined)} />}
          {opening && open && (
            <QuickOpen
              items={items}
              onOpen={(id, onDesk) => (onDesk ? showOnDesk({ itemId: id, nonce: Date.now() }) : openPage(id))}
              onCreate={(title) =>
                void api.createNote('', title).then((made) => {
                  addItems([made])
                  openPage(made.id, true)
                })
              }
              onClose={() => setOpening(false)}
            />
          )}
          {searching && open && <SearchPalette items={items} onOpen={openHit} onClose={() => setSearching(false)} />}
        </>
      )}
    </div>
  )
}
