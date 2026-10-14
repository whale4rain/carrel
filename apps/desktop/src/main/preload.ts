import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { workspaceChannels, type ItemView, type WebApi, type WorkspaceApi, type WorkspaceReply } from '../shared/workspace-api.js'

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
  chooseFiles: () => call(workspaceChannels.chooseFiles),
  addFiles: (paths) => call(workspaceChannels.addFiles, paths),
  addLink: (url) => call(workspaceChannels.addLink, url),
  itemBytes: (id) => call(workspaceChannels.itemBytes, id),
  snapshot: (id) => call(workspaceChannels.snapshot, id),
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
}

// The typed bridge between renderer and main.
contextBridge.exposeInMainWorld('carrel', {
  platform: process.platform,
  workspace,
  web,
  /** The path of a file dropped on the window. */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
})
