import { contextBridge, ipcRenderer } from 'electron'
import { workspaceChannels, type ShellState, type WorkspaceApi, type WorkspaceReply } from '../shared/workspace-api.js'

async function call(channel: string, ...args: string[]): Promise<ShellState> {
  const reply = (await ipcRenderer.invoke(channel, ...args)) as WorkspaceReply
  if ('error' in reply) throw new Error(reply.error)
  return reply.state
}

const workspace: WorkspaceApi = {
  state: () => call(workspaceChannels.state),
  createProject: (name) => call(workspaceChannels.createProject, name),
  openProject: (name) => call(workspaceChannels.openProject, name),
  createDesk: (name) => call(workspaceChannels.createDesk, name),
  openDesk: (id) => call(workspaceChannels.openDesk, id),
}

// The typed bridge between renderer and main.
contextBridge.exposeInMainWorld('carrel', {
  platform: process.platform,
  workspace,
})
