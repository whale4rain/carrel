import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { agentChannels, type AgentApi, type AgentLive, type ProposalView } from '../shared/agent-api.js'
import { workspaceChannels, type ItemView, type ThatView, type WebApi, type WebLoading, type WorkspaceApi, type WorkspaceReply } from '../shared/workspace-api.js'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as WorkspaceReply
  if ('error' in reply) throw new Error(reply.error)
  return reply.value as T
}

const workspace: WorkspaceApi = {
  state: () => call(workspaceChannels.state),
  createProject: (name) => call(workspaceChannels.createProject, name),
  openProject: (name) => call(workspaceChannels.openProject, name),
  createDesk: (name) => call(workspaceChannels.createDesk, name),
  openDesk: (id) => call(workspaceChannels.openDesk, id),
  desk: (id) => call(workspaceChannels.desk, id),
  saveSheets: (id, sheets, change) => call(workspaceChannels.saveSheets, id, sheets, change),
  saveViewport: (id, viewport) => call(workspaceChannels.saveViewport, id, viewport),
  items: () => call(workspaceChannels.items),
  createNote: () => call(workspaceChannels.createNote),
  note: (id) => call(workspaceChannels.note, id),
  saveNote: (id, doc) => call(workspaceChannels.saveNote, id, doc),
  search: (query) => call(workspaceChannels.search, query),
  chooseFiles: () => call(workspaceChannels.chooseFiles),
  addFiles: (paths) => call(workspaceChannels.addFiles, paths),
  addLink: (url) => call(workspaceChannels.addLink, url),
  itemBytes: (id) => call(workspaceChannels.itemBytes, id),
  snapshot: (id) => call(workspaceChannels.snapshot, id),
  readAt: (id) => call(workspaceChannels.readAt, id),
  saveReadAt: (id, at) => call(workspaceChannels.saveReadAt, id, at),
  sourceTitle: (id, title) => call(workspaceChannels.sourceTitle, id, title),
  makeThat: (request) => call(workspaceChannels.makeThat, request),
  thats: () => call(workspaceChannels.thats),
  thatImage: (id) => call(workspaceChannels.thatImage, id),
}

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const web: WebApi = {
  layout: (layout) => ipcRenderer.send('web:layout', layout),
  onLive: (listener) => listen<{ sheet: string | null }>('web:live', ({ sheet }) => listener(sheet)),
  onSnapshot: (listener) =>
    listen<{ sheet: string; itemId: string; png: Uint8Array }>('web:snapshot', ({ sheet, itemId, png }) => listener(sheet, itemId, png)),
  onItem: (listener) => listen<ItemView>('web:item', listener),
  onThat: (listener) => listen<ThatView>('web:that', listener),
  frame: (rect) => ipcRenderer.invoke('web:frame', rect) as Promise<Uint8Array>,
  showThat: (sheet, that) => ipcRenderer.send('web:show-that', { sheet, that }),
  onFound: (listener) => listen<{ that: string; found: boolean }>('web:found', ({ that, found }) => listener(that, found)),
  onShortcut: (listener) => listen<string>('web:shortcut', listener),
  onLoading: (listener) => listen<{ sheet: string; state: WebLoading }>('web:loading', ({ sheet, state }) => listener(sheet, state)),
  fitWidth: (sheet) => ipcRenderer.invoke('web:fit-width', sheet) as Promise<number>,
  reload: (sheet) => ipcRenderer.send('web:reload', sheet),
}

const agent: AgentApi = {
  status: () => call(agentChannels.status),
  saveKey: (key) => call(agentChannels.saveKey, key),
  thread: (thread) => call(agentChannels.thread, thread),
  sides: () => call(agentChannels.sides),
  startSide: (title) => call(agentChannels.startSide, title),
  ask: (text, context, thread) => call(agentChannels.ask, text, context, thread),
  onLive: (listener) => listen<AgentLive>(agentChannels.live, listener),
  onThat: (listener) => listen<ThatView>(agentChannels.that, listener),
  proposals: () => call(agentChannels.proposals),
  decide: (id, accept) => call(agentChannels.decide, id, accept),
  thatTurn: (turnId, thread) => call(agentChannels.thatTurn, turnId, thread),
  addToNote: (turnId, noteId, thread) => call(agentChannels.addToNote, turnId, noteId, thread),
  onProposal: (listener) => listen<ProposalView>(agentChannels.proposal, listener),
}

// The typed bridge between renderer and main.
contextBridge.exposeInMainWorld('carrel', {
  platform: process.platform,
  workspace,
  web,
  agent,
  /** The path of a file dropped on the window. */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
})
