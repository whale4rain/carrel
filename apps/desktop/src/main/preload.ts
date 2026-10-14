import { contextBridge, ipcRenderer } from 'electron'
import { workspaceChannels, type WorkspaceApi, type WorkspaceReply } from '../shared/workspace-api.js'

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
}

// The typed bridge between renderer and main.
contextBridge.exposeInMainWorld('carrel', {
  platform: process.platform,
  workspace,
})
