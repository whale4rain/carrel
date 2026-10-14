import { ipcMain } from 'electron'
import { workspaceChannels, type ShellState, type WorkspaceReply } from '../shared/workspace-api.js'
import type { ShellController } from './shell-state.js'

/** Serves the renderer's workspace calls. Changes run one at a time, so files never interleave. */
export function serveWorkspace(controller: ShellController): void {
  let queue: Promise<unknown> = Promise.resolve()
  const handle = (channel: string, run: (arg: string) => Promise<ShellState>): void => {
    ipcMain.handle(channel, (_event, arg: unknown): Promise<WorkspaceReply> => {
      const next = queue.then(async (): Promise<WorkspaceReply> => {
        try {
          return { state: await run(typeof arg === 'string' ? arg : '') }
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      })
      queue = next
      return next
    })
  }
  handle(workspaceChannels.state, () => controller.state())
  handle(workspaceChannels.createProject, (name) => controller.createProject(name))
  handle(workspaceChannels.openProject, (name) => controller.openProject(name))
  handle(workspaceChannels.createDesk, (name) => controller.createDesk(name))
  handle(workspaceChannels.openDesk, (id) => controller.openDesk(id))
}
