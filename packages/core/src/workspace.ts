import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appendLine, isMissing, readJson, writeJson } from './files.js'
import { assertProjectName, carrelRoots, type CarrelRoots } from './paths.js'

/**
 * Projects and desks on disk (milestone 1, task 4).
 *
 * ~/Carrel/<project>/            your content, visible
 *   project.json                 id, name, desk order
 *   desks/<desk id>.json         one desk: name, viewport, sheets
 *   events.jsonl                 every change, with its actor
 * ~/.carrel/settings.json        what was open last, per project
 *
 * Desk files are named by id, so renaming a desk never moves a file.
 */

export const FORMAT = 1

export type Actor = 'user' | 'agent'

export interface ProjectFile {
  format: typeof FORMAT
  id: string
  name: string
  createdAt: string
  /** Desk ids in sidebar order. */
  desks: string[]
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** Where an item sits on a desk. A sheet with no item is a blank sheet. */
export interface Sheet {
  id: string
  itemId: string | null
  x: number
  y: number
  w: number
  h: number
  scale: number
  z: number
  /** The pile it lies in, if any. */
  pile?: string
  /** Folded down to its label row. */
  folded?: boolean
  /** A web page's own zoom inside its sheet (1 when absent). */
  pageZoom?: number
}

export interface DeskFile {
  format: typeof FORMAT
  id: string
  name: string
  createdAt: string
  viewport: Viewport
  sheets: Sheet[]
}

export interface SheetChange {
  /** What the gesture did: added, moved, resized, scaled, raised, removed... */
  kind: string
  /** The sheets it touched. */
  ids: string[]
  actor?: Actor
}

export interface WorkspaceEvent {
  seq: number
  at: string
  actor: Actor
  type: string
  payload: Record<string, unknown>
}

export interface Settings {
  /** The project open last, by folder name. */
  project?: string
  /** The desk open last in each project: folder name to desk id. */
  desks?: Record<string, string>
}

export interface OpenProject {
  /** The folder name under ~/Carrel, which is also the project's name. */
  folder: string
  project: ProjectFile
  desks: DeskFile[]
}

const DESK_NAME_MAX = 80

/** Throws when `name` can't name a desk. */
export function assertDeskName(name: string): void {
  if (name.trim().length === 0) throw new Error('A desk name cannot be empty.')
  if (name !== name.trim()) throw new Error('A desk name cannot start or end with spaces.')
  if (name.length > DESK_NAME_MAX) throw new Error(`A desk name can be at most ${DESK_NAME_MAX} characters.`)
}

export class Workspace {
  readonly roots: CarrelRoots
  private readonly now: () => Date

  constructor(roots: CarrelRoots = carrelRoots(), now: () => Date = () => new Date()) {
    this.roots = roots
    this.now = now
  }

  /** Project folders under ~/Carrel, by name. Folders without a project.json are not projects. */
  async listProjects(): Promise<string[]> {
    let entries
    try {
      entries = await readdir(this.roots.content, { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const names: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const project = await readJson(join(this.roots.content, entry.name, 'project.json')).catch(() => undefined)
      if (isProjectFile(project)) names.push(entry.name)
    }
    return names.sort((a, b) => a.localeCompare(b))
  }

  /** Makes ~/Carrel/<name>/ with one desk. */
  async createProject(name: string, firstDesk = 'First desk'): Promise<OpenProject> {
    assertProjectName(name)
    assertDeskName(firstDesk)
    const existing = await this.listProjects()
    if (existing.some((other) => other.toLowerCase() === name.toLowerCase())) {
      throw new Error(`There is already a project called "${name}".`)
    }
    const project: ProjectFile = { format: FORMAT, id: randomUUID(), name, createdAt: this.timestamp(), desks: [] }
    await writeJson(this.projectFile(name), project)
    await this.event(name, 'user', 'project.created', { id: project.id, name })
    await this.createDesk(name, firstDesk)
    return this.openProject(name)
  }

  async openProject(folder: string): Promise<OpenProject> {
    assertProjectName(folder)
    const project = await readJson(this.projectFile(folder))
    if (!isProjectFile(project)) throw new Error(`"${folder}" is not a Carrel project.`)
    const desks: DeskFile[] = []
    for (const id of project.desks) {
      const desk = await readJson(this.deskFile(folder, id))
      if (isDeskFile(desk)) desks.push(desk)
    }
    return { folder, project, desks }
  }

  async createDesk(folder: string, name: string): Promise<DeskFile> {
    assertDeskName(name)
    const { project, desks } = await this.openProject(folder)
    if (desks.some((desk) => desk.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`This project already has a desk called "${name}".`)
    }
    const desk: DeskFile = {
      format: FORMAT,
      id: randomUUID(),
      name,
      createdAt: this.timestamp(),
      viewport: { x: 0, y: 0, zoom: 1 },
      sheets: [],
    }
    await writeJson(this.deskFile(folder, desk.id), desk)
    await writeJson(this.projectFile(folder), { ...project, desks: [...project.desks, desk.id] })
    await this.event(folder, 'user', 'desk.created', { id: desk.id, name })
    return desk
  }

  async readDesk(folder: string, id: string): Promise<DeskFile> {
    const { desks } = await this.openProject(folder)
    const desk = desks.find((entry) => entry.id === id)
    if (!desk) throw new Error('That desk is not in this project.')
    return desk
  }

  /**
   * Replaces a desk's sheets after one gesture (a move, a resize, an added
   * sheet), and records it as one event naming what changed.
   */
  async saveSheets(folder: string, id: string, sheets: Sheet[], change: SheetChange): Promise<DeskFile> {
    const desk = await this.readDesk(folder, id)
    const ids = new Set(sheets.map((sheet) => sheet.id))
    if (ids.size !== sheets.length) throw new Error('Two sheets share an id.')
    const next: DeskFile = { ...desk, sheets }
    await writeJson(this.deskFile(folder, id), next)
    await this.event(folder, change.actor ?? 'user', `sheets.${change.kind}`, { desk: id, sheets: change.ids })
    return next
  }

  /**
   * Remembers where a desk is looked at. The view isn't a change to the desk,
   * so it isn't an event.
   */
  async saveViewport(folder: string, id: string, viewport: Viewport): Promise<DeskFile> {
    const desk = await this.readDesk(folder, id)
    const next: DeskFile = { ...desk, viewport }
    await writeJson(this.deskFile(folder, id), next)
    return next
  }

  async readSettings(): Promise<Settings> {
    const settings = await readJson(this.settingsFile()).catch(() => undefined)
    return isSettings(settings) ? settings : {}
  }

  async writeSettings(settings: Settings): Promise<void> {
    await writeJson(this.settingsFile(), settings)
  }

  async readEvents(folder: string): Promise<WorkspaceEvent[]> {
    let text: string
    try {
      text = await readFile(this.eventsFile(folder), 'utf8')
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as WorkspaceEvent)
  }

  /** Appends one event to the project's log. */
  async event(folder: string, actor: Actor, type: string, payload: Record<string, unknown>): Promise<void> {
    const events = await this.readEvents(folder)
    const seq = (events.at(-1)?.seq ?? 0) + 1
    const event: WorkspaceEvent = { seq, at: this.timestamp(), actor, type, payload }
    await appendLine(this.eventsFile(folder), event)
  }

  private timestamp(): string {
    return this.now().toISOString()
  }

  private projectFile(folder: string): string {
    return join(this.roots.content, folder, 'project.json')
  }

  private deskFile(folder: string, id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`"${id}" is not a desk id.`)
    return join(this.roots.content, folder, 'desks', `${id}.json`)
  }

  private eventsFile(folder: string): string {
    return join(this.roots.content, folder, 'events.jsonl')
  }

  private settingsFile(): string {
    return join(this.roots.internal, 'settings.json')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProjectFile(value: unknown): value is ProjectFile {
  return (
    isRecord(value) &&
    value.format === FORMAT &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    Array.isArray(value.desks) &&
    value.desks.every((id) => typeof id === 'string')
  )
}

function isDeskFile(value: unknown): value is DeskFile {
  return isRecord(value) && value.format === FORMAT && typeof value.id === 'string' && typeof value.name === 'string'
}

function isSettings(value: unknown): value is Settings {
  if (!isRecord(value)) return false
  const { project, desks } = value
  return (
    (project === undefined || typeof project === 'string') &&
    (desks === undefined || (isRecord(desks) && Object.values(desks).every((id) => typeof id === 'string')))
  )
}
