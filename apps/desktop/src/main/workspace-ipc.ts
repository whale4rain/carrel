import { dialog, ipcMain } from 'electron'
import { delimiter } from 'node:path'
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
    items: () => controller.items(),
    chooseFiles: async () => {
      // The smoke check stands in for the person at the file dialog.
      const stand = process.env.CARREL_CHOOSE_FILES
      if (stand) return stand.split(delimiter)
      const chosen = await dialog.showOpenDialog({
        title: 'Add books and papers',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      return chosen.canceled ? [] : chosen.filePaths
    },
    addFiles: (paths) => controller.addFiles(paths),
    addLink: (url) => controller.addLink(text(url)),
    itemBytes: (id) => controller.itemBytes(text(id)),
    snapshot: (id) => controller.snapshot(text(id)),
    sourceTitle: async (id, title) => (await controller.pageTitle(text(id), text(title).slice(0, 300))) ?? null,
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
