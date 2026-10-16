/**
 * How a saved view picks and orders notes. Pure, so the renderer draws a
 * view with the same rules the tests check.
 *
 * A field is "title", "folder", "tags", "updated", "created", "links" (how
 * many notes link here), "cites" (how many sources it cites), or a property
 * as "property:<name>".
 */
import type { PropertyValue } from './properties.js'

export type FilterOp = 'is' | 'is not' | 'contains' | 'is empty' | 'is not empty' | 'before' | 'after' | 'is checked' | 'is not checked'

export const FILTER_OPS: readonly FilterOp[] = ['is', 'is not', 'contains', 'is empty', 'is not empty', 'before', 'after', 'is checked', 'is not checked']

/** Filters that need no value. */
export const NO_VALUE: readonly FilterOp[] = ['is empty', 'is not empty', 'is checked', 'is not checked']

export interface NoteFilter {
  field: string
  op: FilterOp
  /** What to compare with; none for "is empty", "is not empty", "is checked". */
  value?: string
}

export interface NoteViewSpec {
  id: string
  name: string
  layout: 'table' | 'cards'
  filters: NoteFilter[]
  sort: { field: string; descending: boolean }
  columns: string[]
}

/** Fields a new view shows. */
export const DEFAULT_COLUMNS = ['title', 'folder', 'tags', 'updated']

/** Fields every note has, in the order they are offered. */
export const NOTE_FIELDS = ['title', 'folder', 'tags', 'updated', 'created', 'links', 'cites'] as const

/** One note as a view sees it. */
export interface NoteRow {
  id: string
  title: string
  folder: string
  tags: string[]
  updated: string
  created: string
  /** How many other notes link to it. */
  links: number
  /** How many sources it cites. */
  cites: number
  properties: Record<string, PropertyValue>
}

export function fieldLabel(field: string): string {
  if (field.startsWith('property:')) return field.slice('property:'.length)
  return { title: 'Title', folder: 'Folder', tags: 'Tags', updated: 'Edited', created: 'Made', links: 'Linked here', cites: 'Cites' }[field] ?? field
}

/** A row's value for a field: text, a number, true or false, a list, or nothing. */
export function valueOf(row: NoteRow, field: string): PropertyValue | undefined {
  if (field.startsWith('property:')) {
    const name = field.slice('property:'.length).toLowerCase()
    const key = Object.keys(row.properties).find((known) => known.toLowerCase() === name)
    return key === undefined ? undefined : row.properties[key]
  }
  switch (field) {
    case 'title':
      return row.title
    case 'folder':
      return row.folder
    case 'tags':
      return row.tags
    case 'updated':
      return row.updated.slice(0, 10)
    case 'created':
      return row.created.slice(0, 10)
    case 'links':
      return row.links
    case 'cites':
      return row.cites
    default:
      return undefined
  }
}

function empty(value: PropertyValue | undefined): boolean {
  return value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

/** Whether a row passes a filter. Text compares without case; a folder "is" also takes the folders inside it. */
export function matches(row: NoteRow, filter: NoteFilter): boolean {
  const value = valueOf(row, filter.field)
  const wanted = (filter.value ?? '').trim().toLowerCase()
  const texts = Array.isArray(value) ? value.map((item) => item.toLowerCase()) : value === undefined ? [] : [String(value).toLowerCase()]
  switch (filter.op) {
    case 'is empty':
      return empty(value)
    case 'is not empty':
      return !empty(value)
    case 'is checked':
      return value === true
    case 'is not checked':
      return value !== true
    case 'is':
      if (filter.field === 'folder') return texts.some((text) => text === wanted || text.startsWith(`${wanted}/`))
      // A tag may be written with or without its #.
      return texts.some((text) => text === (filter.field === 'tags' ? wanted.replace(/^#/, '') : wanted))
    case 'is not':
      return !matches(row, { ...filter, op: 'is' })
    case 'contains':
      return texts.some((text) => text.includes(wanted))
    case 'before':
    case 'after': {
      if (value === undefined || empty(value) || wanted === '') return false
      if (typeof value === 'number') return filter.op === 'before' ? value < Number(wanted) : value > Number(wanted)
      const text = String(value).toLowerCase()
      return filter.op === 'before' ? text < wanted : text > wanted
    }
  }
}

/** The rows a view shows, in its order; rows without the sort field go last. */
export function applyView(rows: readonly NoteRow[], view: Pick<NoteViewSpec, 'filters' | 'sort'>): NoteRow[] {
  const kept = rows.filter((row) => view.filters.every((filter) => matches(row, filter)))
  const key = (row: NoteRow): string | number | undefined => {
    // Dates sort by the full time, so notes edited the same day keep their order.
    const value = view.sort.field === 'updated' || view.sort.field === 'created' ? row[view.sort.field] : valueOf(row, view.sort.field)
    if (value === undefined || empty(value)) return undefined
    if (typeof value === 'number') return value
    if (typeof value === 'boolean') return value ? 1 : 0
    return (Array.isArray(value) ? value.join(', ') : value).toLowerCase()
  }
  return kept.sort((a, b) => {
    const [x, y] = [key(a), key(b)]
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
    return view.sort.descending ? -order : order
  })
}

/** Every field the rows have, notes' own first, then properties by name. */
export function fieldsOf(rows: readonly NoteRow[]): string[] {
  const names = new Map<string, string>()
  for (const row of rows) for (const key of Object.keys(row.properties)) if (!names.has(key.toLowerCase())) names.set(key.toLowerCase(), key)
  return [...NOTE_FIELDS, ...[...names.values()].sort((a, b) => a.localeCompare(b)).map((name) => `property:${name}`)]
}
