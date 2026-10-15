import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  Anchors,
  isNoteDoc,
  Library,
  Notes,
  momentSelector,
  pageSelector,
  regionSelector,
  textSelectors,
  titleFromUrl,
  type AnchorFile,
  type DeskFile,
  type ItemFile,
  type NoteFile,
  type NoteSummary,
  type OpenProject,
  type Selector,
  type Sheet,
  type SheetChange,
  type Viewport,
  type Workspace,
} from '@carrel/core'
import type { DeskView, ItemView, NoteView, ShellState, ThatView } from '../shared/workspace-api.js'

/**
 * Turns the workspace on disk into what the shell shows, and remembers what
 * was open in ~/.carrel/settings.json so a restart comes back to it.
 */
export class ShellController {
  private readonly workspace: Workspace
  private readonly library: Library
  private readonly anchors: Anchors
  private readonly notes: Notes

  constructor(workspace: Workspace, library = new Library(workspace), anchors = new Anchors(workspace), notes = new Notes(workspace)) {
    this.workspace = workspace
    this.library = library
    this.anchors = anchors
    this.notes = notes
  }

  async state(): Promise<ShellState> {
    const projects = await this.workspace.listProjects()
    const settings = await this.workspace.readSettings()
    const folder = settings.project !== undefined && projects.includes(settings.project) ? settings.project : projects[0]
    if (folder === undefined) return { projects }
    const opened = await this.workspace.openProject(folder)
    const remembered = settings.desks?.[folder]
    const desk = opened.desks.find((entry) => entry.id === remembered) ?? opened.desks[0]
    return { projects, open: summary(opened, desk?.id) }
  }

  async createProject(name: string): Promise<ShellState> {
    const opened = await this.workspace.createProject(name)
    await this.remember(opened.folder, opened.desks[0]?.id)
    return this.state()
  }

  async openProject(name: string): Promise<ShellState> {
    // Each project comes back at the desk it was left on.
    await this.workspace.openProject(name)
    await this.remember(name, undefined)
    return this.state()
  }

  async createDesk(name: string): Promise<ShellState> {
    const folder = await this.openFolder()
    const desk = await this.workspace.createDesk(folder, name)
    await this.remember(folder, desk.id)
    return this.state()
  }

  async openDesk(id: string): Promise<ShellState> {
    const folder = await this.openFolder()
    const opened = await this.workspace.openProject(folder)
    if (!opened.desks.some((desk) => desk.id === id)) throw new Error('That desk is not in this project.')
    await this.remember(folder, id)
    return this.state()
  }

  async desk(id: string): Promise<DeskView> {
    return view(await this.workspace.readDesk(await this.openFolder(), id))
  }

  /** Sheets come from the renderer, so they're checked before they reach the file. */
  async saveSheets(id: string, sheets: unknown, change: unknown): Promise<DeskView> {
    if (!Array.isArray(sheets) || !sheets.every(isSheet)) throw new Error('Those are not sheets.')
    if (!isChange(change)) throw new Error('That is not a sheet change.')
    return view(await this.workspace.saveSheets(await this.openFolder(), id, sheets, { kind: change.kind, ids: change.ids }))
  }

  async saveViewport(id: string, viewport: unknown): Promise<DeskView> {
    if (!isViewport(viewport)) throw new Error('That is not a view of a desk.')
    const { x, y, zoom } = viewport
    return view(await this.workspace.saveViewport(await this.openFolder(), id, { x, y, zoom }))
  }

  /** The project's sources, then its notes (most recently changed first). */
  async items(): Promise<ItemView[]> {
    const { open } = await this.state()
    if (!open) return []
    const sources = await this.citedItems(open.project)
    return [...(await this.library.list(open.project)).map(itemView), ...(await this.notes.list(open.project)).map((note) => noteItem(note, sources))]
  }

  async createNote(): Promise<ItemView> {
    return noteItem(await this.notes.create(await this.openFolder()), new Map())
  }

  async note(id: string): Promise<NoteView> {
    return noteView(await this.notes.read(await this.openFolder(), id))
  }

  /** A note's new text from the editor, checked before it is written. */
  async saveNote(id: string, doc: unknown): Promise<ItemView> {
    if (typeof id !== 'string' || !isNoteDoc(doc)) throw new Error('That is not a note.')
    const folder = await this.openFolder()
    return noteItem(await this.notes.save(folder, id, doc), await this.citedItems(folder))
  }

  /** Which item each *that.* points into, so a note knows the sources it cites. */
  private async citedItems(folder: string): Promise<Map<string, string>> {
    return new Map((await this.anchors.list(folder)).map((anchor) => [anchor.id, anchor.itemId]))
  }

  async addFiles(paths: unknown): Promise<ItemView[]> {
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) throw new Error('Those are not files.')
    const folder = await this.openFolder()
    const added: ItemView[] = []
    for (const path of paths) added.push(itemView(await this.library.addFile(folder, path)))
    return added
  }

  async addLink(url: string): Promise<ItemView> {
    return itemView(await this.library.addLink(await this.openFolder(), url))
  }

  async itemBytes(id: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(await this.library.filePath(await this.openFolder(), id)))
  }

  /** A web page's last snapshot (PNG bytes), if it has one. */
  async snapshot(id: string): Promise<Uint8Array | null> {
    const path = this.library.snapshotPath(await this.openFolder(), id)
    return readFile(path).then(
      (bytes) => new Uint8Array(bytes),
      () => null,
    )
  }

  async saveSnapshot(id: string, png: Uint8Array): Promise<void> {
    const path = this.library.snapshotPath(await this.openFolder(), id)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, png)
  }

  /**
   * A web page told us its title. It replaces the name made from the link,
   * but never a name already changed.
   */
  async pageTitle(id: string, title: string): Promise<ItemView | undefined> {
    const folder = await this.openFolder()
    const item = await this.library.read(folder, id)
    if (item.source.storage !== 'linked' || item.title !== titleFromUrl(new URL(item.source.url))) return undefined
    return itemView(await this.library.setTitle(folder, id, title))
  }

  /** A *that.* from the renderer or a live page: checked, turned into selectors, kept. */
  async makeThat(request: unknown): Promise<ThatView> {
    if (typeof request !== 'object' || request === null) throw new Error('That is not a place in a source.')
    const { itemId, page, text, seconds, region, image } = request as Record<string, unknown>
    if (typeof itemId !== 'string') throw new Error('That is not a place in a source.')
    const folder = await this.openFolder()
    await this.library.read(folder, itemId)
    const selectors: Selector[] = []
    if (page !== undefined) selectors.push(pageSelector(Number(page)))
    let quoted: string | undefined
    if (text !== undefined) {
      const { source, start, end } = (text ?? {}) as Record<string, unknown>
      if (typeof source !== 'string' || typeof start !== 'number' || typeof end !== 'number') throw new Error('That selection is not in the text.')
      selectors.push(...textSelectors(source, start, end))
      quoted = source.slice(start, end)
    }
    if (seconds !== undefined) selectors.push(momentSelector(Number(seconds)))
    if (region !== undefined) {
      const { x, y, w, h } = (region ?? {}) as Record<string, unknown>
      selectors.push(regionSelector({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) }))
    }
    const png = image instanceof Uint8Array ? image : undefined
    return thatView(await this.anchors.make(folder, { itemId, selectors, ...(quoted ? { text: quoted } : {}), ...(png ? { image: png } : {}) }))
  }

  async thats(): Promise<ThatView[]> {
    const { open } = await this.state()
    return open ? (await this.anchors.list(open.project)).map(thatView) : []
  }

  async thatImage(id: string): Promise<Uint8Array | null> {
    const path = await this.anchors.imagePath(await this.openFolder(), id)
    return path ? new Uint8Array(await readFile(path)) : null
  }

  private async openFolder(): Promise<string> {
    const { open } = await this.state()
    if (!open) throw new Error('Create a project first.')
    return open.project
  }

  private async remember(project: string, desk: string | undefined): Promise<void> {
    const settings = await this.workspace.readSettings()
    const desks = desk === undefined ? settings.desks : { ...settings.desks, [project]: desk }
    await this.workspace.writeSettings({ ...settings, project, ...(desks ? { desks } : {}) })
  }
}

function summary(opened: OpenProject, desk: string | undefined): NonNullable<ShellState['open']> {
  return {
    project: opened.folder,
    desks: opened.desks.map(({ id, name }) => ({ id, name })),
    desk: desk ?? '',
  }
}

function itemView(item: ItemFile): ItemView {
  const base = { id: item.id, kind: item.kind, title: item.title }
  return item.source.storage === 'linked' ? { ...base, url: item.source.url } : { ...base, file: { name: item.source.file, size: item.source.size } }
}

function noteItem(note: NoteSummary, sources: ReadonlyMap<string, string>): ItemView {
  const cites = [...new Set(note.cites.flatMap((that) => (sources.has(that) ? [sources.get(that)!] : [])))]
  return { id: note.id, kind: 'note', title: note.title, updatedAt: note.updatedAt, tags: note.tags, cites }
}

function noteView(note: NoteFile): NoteView {
  return { id: note.id, title: note.title, doc: note.doc, updatedAt: note.updatedAt }
}

function thatView(anchor: AnchorFile): ThatView {
  return {
    id: anchor.id,
    itemId: anchor.itemId,
    label: anchor.label,
    selectors: anchor.selectors,
    ...(anchor.snapshot.text ? { text: anchor.snapshot.text } : {}),
    image: anchor.snapshot.image !== undefined,
    createdAt: anchor.createdAt,
  }
}

function view(desk: DeskFile): DeskView {
  return { id: desk.id, name: desk.name, sheets: desk.sheets, viewport: desk.viewport }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function isSheet(value: unknown): value is Sheet {
  if (typeof value !== 'object' || value === null) return false
  const sheet = value as Record<string, unknown>
  return (
    typeof sheet.id === 'string' &&
    (sheet.itemId === null || typeof sheet.itemId === 'string') &&
    finite(sheet.x) &&
    finite(sheet.y) &&
    finite(sheet.w) &&
    finite(sheet.h) &&
    finite(sheet.scale) &&
    sheet.scale >= 0.3 &&
    sheet.scale <= 1 &&
    finite(sheet.z) &&
    (sheet.pile === undefined || typeof sheet.pile === 'string')
  )
}

function isViewport(value: unknown): value is Viewport {
  if (typeof value !== 'object' || value === null) return false
  const viewport = value as Record<string, unknown>
  return finite(viewport.x) && finite(viewport.y) && finite(viewport.zoom) && viewport.zoom >= 0.25 && viewport.zoom <= 2
}

function isChange(value: unknown): value is SheetChange {
  if (typeof value !== 'object' || value === null) return false
  const change = value as Record<string, unknown>
  return (
    typeof change.kind === 'string' &&
    /^[a-z-]+$/.test(change.kind) &&
    Array.isArray(change.ids) &&
    change.ids.every((id) => typeof id === 'string')
  )
}
