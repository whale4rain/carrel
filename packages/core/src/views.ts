import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readJson, writeJson } from './files.js'
import { DEFAULT_COLUMNS, FILTER_OPS, type FilterOp, type NoteViewSpec } from './view-rows.js'
import type { Actor, Workspace } from './workspace.js'

/**
 * Saved views of a project's notes, the part of Notion's databases study
 * needs: which notes (filters), in what order (sort), showing which fields
 * (columns), as a table or as cards. Kept in one file with the project:
 *
 * ~/Carrel/<project>/views.json
 *
 * What a view holds, and how it picks and orders notes, is in view-rows.ts.
 */
interface ViewsFile {
  format: 1
  views: NoteViewSpec[]
}

const NAME_MAX = 80
const FIELD = /^(title|folder|tags|updated|created|links|cites|property:[^\n:]{1,60})$/

export class NoteViews {
  constructor(private readonly workspace: Workspace) {}

  async list(folder: string): Promise<NoteViewSpec[]> {
    const file = (await readJson(this.file(folder))) as ViewsFile | undefined
    return (file?.views ?? []).filter(isViewSpec)
  }

  /** A new view, named, showing every note. */
  async create(folder: string, name: string, actor: Actor = 'user'): Promise<NoteViewSpec> {
    const view: NoteViewSpec = { id: randomUUID(), name: cleanName(name), layout: 'table', filters: [], sort: { field: 'updated', descending: true }, columns: [...DEFAULT_COLUMNS] }
    await this.write(folder, [...(await this.list(folder)), view])
    await this.workspace.event(folder, actor, 'view.added', { id: view.id })
    return view
  }

  /** Writes a view's new name, filters, sort, columns or layout. */
  async save(folder: string, view: unknown, actor: Actor = 'user'): Promise<NoteViewSpec> {
    if (!isViewSpec(view)) throw new Error('That is not a view of notes.')
    const views = await this.list(folder)
    const at = views.findIndex((known) => known.id === view.id)
    if (at < 0) throw new Error('That view is not in this project.')
    const saved = { ...view, name: cleanName(view.name) }
    views[at] = saved
    await this.write(folder, views)
    await this.workspace.event(folder, actor, 'view.changed', { id: view.id })
    return saved
  }

  async remove(folder: string, id: string, actor: Actor = 'user'): Promise<void> {
    const views = await this.list(folder)
    if (!views.some((view) => view.id === id)) return
    await this.write(folder, views.filter((view) => view.id !== id))
    await this.workspace.event(folder, actor, 'view.removed', { id })
  }

  private async write(folder: string, views: NoteViewSpec[]): Promise<void> {
    await writeJson(this.file(folder), { format: 1, views } satisfies ViewsFile)
  }

  private file(folder: string): string {
    return join(this.workspace.roots.content, folder, 'views.json')
  }
}

function cleanName(name: string): string {
  const clean = name.trim().slice(0, NAME_MAX)
  return clean || 'Untitled view'
}

export function isViewSpec(value: unknown): value is NoteViewSpec {
  if (typeof value !== 'object' || value === null) return false
  const view = value as Record<string, unknown>
  const sort = view.sort as Record<string, unknown> | undefined
  return (
    typeof view.id === 'string' &&
    /^[\w-]+$/.test(view.id) &&
    typeof view.name === 'string' &&
    (view.layout === 'table' || view.layout === 'cards') &&
    Array.isArray(view.filters) &&
    view.filters.length <= 20 &&
    view.filters.every(isFilter) &&
    typeof sort?.field === 'string' &&
    FIELD.test(sort.field) &&
    typeof sort.descending === 'boolean' &&
    Array.isArray(view.columns) &&
    view.columns.length <= 30 &&
    view.columns.every((column) => typeof column === 'string' && FIELD.test(column))
  )
}

function isFilter(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const filter = value as Record<string, unknown>
  return typeof filter.field === 'string' && FIELD.test(filter.field) && FILTER_OPS.includes(filter.op as FilterOp) && (filter.value === undefined || (typeof filter.value === 'string' && filter.value.length <= 200))
}
