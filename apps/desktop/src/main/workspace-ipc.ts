import { dialog, ipcMain } from 'electron'
import { STORED_EXTENSIONS } from '@carrel/core'
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
    createNote: (folder, title) => controller.createNote(folder === undefined || folder === null ? '' : text(folder), title === undefined || title === null ? undefined : text(title).slice(0, 200)),
    mentions: (id) => controller.mentions(text(id)),
    linkMention: (from, to) => controller.linkMention(text(from), text(to)),
    pinNote: (id, pinned) => controller.pinNote(text(id), pinned === true),
    setProperty: (id, key, value) => controller.setProperty(text(id), text(key), value),
    noteViews: () => controller.noteViews(),
    createView: (name) => controller.createView(text(name)),
    saveView: (view) => controller.saveView(view),
    deleteView: (id) => controller.deleteView(text(id)),
    dailyNote: () => controller.dailyNote(),
    noteFolders: () => controller.noteFolders(),
    createFolder: (path) => controller.createFolder(text(path)),
    renameFolder: (from, to) => controller.renameFolder(text(from), text(to)),
    moveNote: (id, folder) => controller.moveNote(text(id), text(folder)),
    note: (id) => controller.note(text(id)),
    saveNote: (id, doc) => controller.saveNote(text(id), doc),
    search: (query) => controller.search(text(query).slice(0, 200)),
    chooseFiles: async () => {
      // The smoke check stands in for the person at the file dialog.
      const stand = process.env.CARREL_CHOOSE_FILES
      if (stand) return stand.split(delimiter)
      const chosen = await dialog.showOpenDialog({
        title: 'Add books, papers and documents',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Books, papers and documents', extensions: STORED_EXTENSIONS.map((extension) => extension.slice(1)) }],
      })
      return chosen.canceled ? [] : chosen.filePaths
    },
    addFiles: (paths) => controller.addFiles(paths),
    addLink: (url) => controller.addLink(text(url)),
    itemBytes: (id) => controller.itemBytes(text(id)),
    snapshot: (id) => controller.snapshot(text(id)),
    document: (id) => controller.document(text(id)),
    readAt: (id) => controller.readAt(text(id)),
    saveReadAt: (id, at) => controller.saveReadAt(text(id), at),
    setBookmark: (id, page, label) => controller.setBookmark(text(id), page, label),
    makeThat: (request) => controller.makeThat(request),
    thats: () => controller.thats(),
    thatImage: (id) => controller.thatImage(text(id)),
    removeThat: (id) => controller.removeThat(text(id)),
    kits: () => controller.kits(),
    addKit: (name, allow) => controller.addKit(text(name), allow === true),
    kitCall: (name, method, args) => controller.kitCall(text(name), text(method), Array.isArray(args) ? args.slice(0, 8) : []),
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
