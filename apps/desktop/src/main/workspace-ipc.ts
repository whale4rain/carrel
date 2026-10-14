import { ipcMain } from 'electron'
import { workspaceChannels, type WorkspaceApi, type WorkspaceReply } from '../shared/workspace-api.js'
import type { ShellController } from './shell-state.js'

/**
 * Serves the renderer's workspace calls. Changes run one at a time, so files
 * never interleave. Returns a function that resolves once every call so far
 * has finished, so quitting can wait for the last save.
 */
export function serveWorkspace(controller: ShellController): () => Promise<void> {
  let queue: Promise<unknown> = Promise.resolve()
  const handle = (channel: string, run: (...args: unknown[]) => Promise<unknown>): void => {
    ipcMain.handle(channel, (_event, ...args: unknown[]): Promise<WorkspaceReply> => {
      const next = queue.then(async (): Promise<WorkspaceReply> => {
        try {
          return { value: await run(...args) }
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      })
      queue = next
      return next
    })
  }
  const api: Record<keyof WorkspaceApi, (...args: unknown[]) => Promise<unknown>> = {
    state: () => controller.state(),
    createProject: (name) => controller.createProject(text(name)),
    openProject: (name) => controller.openProject(text(name)),
    createDesk: (name) => controller.createDesk(text(name)),
    openDesk: (id) => controller.openDesk(text(id)),
    desk: (id) => controller.desk(text(id)),
    saveSheets: (id, sheets, change) => controller.saveSheets(text(id), sheets, change),
    saveViewport: (id, viewport) => controller.saveViewport(text(id), viewport),
  }
  for (const [name, run] of Object.entries(api)) handle(workspaceChannels[name as keyof WorkspaceApi], run)
  return async () => {
    await queue
  }
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected text.')
  return value
}
