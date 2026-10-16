import { applyView, fieldLabel, fieldsOf, NO_VALUE, valueOf, type FilterOp, type NoteFilter, type NoteRow } from '@carrel/core/view-rows'
import { useState } from 'react'
import type { ItemView, NoteViewSpec, PropertyValue } from '../shared/workspace-api.js'
import { PropertyField } from './NoteProperties.js'

/** The filters offered for each kind of field. */
const OPS: Record<'text' | 'list' | 'date' | 'number' | 'any', FilterOp[]> = {
  text: ['is', 'is not', 'contains', 'is empty', 'is not empty'],
  list: ['is', 'is not', 'contains', 'is empty', 'is not empty'],
  date: ['is', 'before', 'after', 'is empty', 'is not empty'],
  number: ['is', 'before', 'after', 'is empty', 'is not empty'],
  any: ['is', 'is not', 'contains', 'before', 'after', 'is empty', 'is not empty', 'is checked', 'is not checked'],
}

function opsFor(field: string): FilterOp[] {
  if (field === 'title' || field === 'folder') return OPS.text
  if (field === 'tags') return OPS.list
  if (field === 'updated' || field === 'created') return OPS.date
  if (field === 'links' || field === 'cites') return OPS.number
  return OPS.any
}

/** "before" and "after" read better for dates and counts as "less than" and "more than" on counts. */
function opLabel(field: string, op: FilterOp): string {
  if (field === 'links' || field === 'cites') return op === 'before' ? 'fewer than' : op === 'after' ? 'more than' : op
  return op
}

/** The project's notes as view rows; "links" counts the other notes linking here. */
export function rowsOf(items: ReadonlyMap<string, ItemView>): NoteRow[] {
  const notes = [...items.values()].filter((item) => item.kind === 'note')
  return notes.map((note) => {
    const names = new Set([note.title.toLowerCase(), (note.name ?? note.title).toLowerCase()])
    return {
      id: note.id,
      title: note.title,
      folder: note.folder ?? '',
      tags: note.tags ?? [],
      updated: note.updatedAt ?? '',
      created: note.createdAt ?? '',
      links: notes.filter((other) => other.id !== note.id && other.links?.some((link) => names.has(link.split('#')[0]!.trim().toLowerCase()))).length,
      cites: note.cites?.length ?? 0,
      properties: note.properties ?? {},
    }
  })
}

function shown(value: PropertyValue | undefined): string {
  if (value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? '✓' : ''
  return String(value)
}

interface Props {
  view: NoteViewSpec
  items: ReadonlyMap<string, ItemView>
  onSave: (view: NoteViewSpec) => void
  onDelete: () => void
  onOpenNote: (id: string) => void
  /** Sets a note's property from a cell; `null` takes it away. */
  onProperty: (id: string, key: string, value: PropertyValue | null) => Promise<void>
  /** A new note that the view shows: in the folder and with the properties its filters ask for. */
  onCreateNote: (folder: string, properties: Record<string, PropertyValue>) => void
}

/**
 * A saved view of the project's notes, as Notion's databases show them: the
 * notes its filters keep, in its order, as a table or as cards. Property
 * cells are edited in place and written to each note's header.
 */
export function NotesView({ view, items, onSave, onDelete, onOpenNote, onProperty, onCreateNote }: Props) {
  const all = rowsOf(items)
  const rows = applyView(all, view)
  const fields = fieldsOf(all)
  const [panel, setPanel] = useState<'filter' | 'fields'>()
  const change = (patch: Partial<NoteViewSpec>): void => onSave({ ...view, ...patch })
  const sortBy = (field: string): void => change({ sort: { field, descending: view.sort.field === field ? !view.sort.descending : false } })

  const create = (): void => {
    let folder = ''
    const properties: Record<string, PropertyValue> = {}
    for (const filter of view.filters) {
      if (filter.op !== 'is' && filter.op !== 'is checked') continue
      if (filter.field === 'folder') folder = filter.value ?? ''
      else if (filter.field === 'tags' && filter.value) properties.tags = [filter.value.replace(/^#/, '')]
      else if (filter.field.startsWith('property:')) properties[filter.field.slice('property:'.length)] = filter.op === 'is checked' ? true : (filter.value ?? '')
    }
    onCreateNote(folder, properties)
  }

  const cell = (row: NoteRow, field: string) => {
    if (field === 'title')
      return (
        <button type="button" className="view-title" onClick={() => onOpenNote(row.id)}>
          {row.title}
        </button>
      )
    if (!field.startsWith('property:')) return <span className={field === 'updated' || field === 'created' || field === 'links' || field === 'cites' ? 'view-mono' : undefined}>{field === 'tags' ? row.tags.map((tag) => `#${tag}`).join(' ') : shown(valueOf(row, field))}</span>
    const name = field.slice('property:'.length)
    const key = Object.keys(row.properties).find((known) => known.toLowerCase() === name.toLowerCase()) ?? name
    const value = row.properties[key]
    const set = (next: PropertyValue | null): void => void onProperty(row.id, key, next)
    if (value === undefined)
      return (
        <input
          className="note-prop-value"
          aria-label={`${name} of ${row.title}`}
          placeholder="Empty"
          spellCheck={false}
          onBlur={(event) => event.target.value.trim() && set(event.target.value.trim())}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
      )
    return <PropertyField name={`${name} of ${row.title}`} value={value} onChange={set} />
  }

  return (
    <main className="notes-view" aria-label={`View: ${view.name}`}>
      <header className="notes-view-head">
        <input
          key={view.name}
          className="notes-view-name"
          aria-label="View name"
          defaultValue={view.name}
          spellCheck={false}
          onBlur={(event) => event.target.value.trim() && event.target.value.trim() !== view.name && change({ name: event.target.value.trim() })}
          onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
        />
        <div className="segmented" role="group" aria-label="Layout">
          {(['table', 'cards'] as const).map((layout) => (
            <button type="button" key={layout} aria-pressed={view.layout === layout} onClick={() => change({ layout })}>
              {layout === 'table' ? 'Table' : 'Cards'}
            </button>
          ))}
        </div>
        <button type="button" className="outline-button" onClick={onDelete}>
          Delete view
        </button>
      </header>

      <div className="notes-view-bar">
        {view.filters.map((filter, at) => (
          <span className="view-chip" key={at}>
            {fieldLabel(filter.field)} {opLabel(filter.field, filter.op)}
            {filter.value !== undefined && !NO_VALUE.includes(filter.op) && <b> {filter.value}</b>}
            <button type="button" aria-label={`Remove filter ${fieldLabel(filter.field)}`} onClick={() => change({ filters: view.filters.filter((_, other) => other !== at) })}>
              ×
            </button>
          </span>
        ))}
        <span className="view-pop-anchor">
          <button type="button" className="view-bar-button" aria-expanded={panel === 'filter'} onClick={() => setPanel(panel === 'filter' ? undefined : 'filter')}>
            + Filter
          </button>
          {panel === 'filter' && (
            <AddFilter
              fields={fields}
              onAdd={(filter) => {
                change({ filters: [...view.filters, filter] })
                setPanel(undefined)
              }}
              onCancel={() => setPanel(undefined)}
            />
          )}
        </span>
        <span className="grow" />
        <label className="view-sort">
          Sort
          <select aria-label="Sort by" value={view.sort.field} onChange={(event) => change({ sort: { ...view.sort, field: event.target.value } })}>
            {fields.map((field) => (
              <option key={field} value={field}>
                {fieldLabel(field)}
              </option>
            ))}
          </select>
          <button type="button" className="view-bar-button" aria-label={view.sort.descending ? 'Descending' : 'Ascending'} onClick={() => change({ sort: { ...view.sort, descending: !view.sort.descending } })}>
            {view.sort.descending ? '↓' : '↑'}
          </button>
        </label>
        <span className="view-pop-anchor">
          <button type="button" className="view-bar-button" aria-expanded={panel === 'fields'} onClick={() => setPanel(panel === 'fields' ? undefined : 'fields')}>
            Fields
          </button>
          {panel === 'fields' && (
            <div className="view-pop" role="dialog" aria-label="Fields shown">
              {fields.map((field) => (
                <label key={field} className="view-pop-row">
                  <input
                    type="checkbox"
                    checked={view.columns.includes(field)}
                    disabled={field === 'title'}
                    onChange={(event) => change({ columns: event.target.checked ? [...view.columns, field] : view.columns.filter((column) => column !== field) })}
                  />
                  {fieldLabel(field)}
                </label>
              ))}
            </div>
          )}
        </span>
      </div>

      {view.layout === 'table' ? (
        <div className="notes-view-scroll">
          <table className="view-table">
            <thead>
              <tr>
                {view.columns.map((field) => (
                  <th key={field} aria-sort={view.sort.field === field ? (view.sort.descending ? 'descending' : 'ascending') : undefined}>
                    <button type="button" onClick={() => sortBy(field)}>
                      {fieldLabel(field)}
                      {view.sort.field === field && <span aria-hidden>{view.sort.descending ? ' ↓' : ' ↑'}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {view.columns.map((field) => (
                    <td key={field}>{cell(row, field)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <NewRow count={rows.length} onCreate={create} />
        </div>
      ) : (
        <div className="notes-view-scroll">
          <ul className="view-cards">
            {rows.map((row) => (
              <li key={row.id} className="view-card">
                <button type="button" className="view-card-title" onClick={() => onOpenNote(row.id)}>
                  {row.title}
                </button>
                {view.columns
                  .filter((field) => field !== 'title')
                  .map((field) => {
                    const text = field === 'tags' ? row.tags.map((tag) => `#${tag}`).join(' ') : shown(valueOf(row, field))
                    return text ? (
                      <p key={field} className="view-card-field">
                        <span>{fieldLabel(field)}</span> {text}
                      </p>
                    ) : null
                  })}
              </li>
            ))}
          </ul>
          <NewRow count={rows.length} onCreate={create} />
        </div>
      )}
    </main>
  )
}

function NewRow({ count, onCreate }: { count: number; onCreate: () => void }) {
  return (
    <div className="view-foot">
      <button type="button" className="view-bar-button" onClick={onCreate}>
        + New note in this view
      </button>
      <span className="view-mono">
        {count} {count === 1 ? 'note' : 'notes'}
      </span>
    </div>
  )
}

function AddFilter({ fields, onAdd, onCancel }: { fields: string[]; onAdd: (filter: NoteFilter) => void; onCancel: () => void }) {
  const [field, setField] = useState(fields.find((known) => known.startsWith('property:')) ?? 'folder')
  const ops = opsFor(field)
  const [op, setOp] = useState<FilterOp>(ops[0]!)
  const [value, setValue] = useState('')
  const needsValue = !NO_VALUE.includes(op)
  const add = (): void => {
    if (needsValue && !value.trim()) return
    onAdd(needsValue ? { field, op, value: value.trim() } : { field, op })
  }
  return (
    <div className="view-pop" role="dialog" aria-label="Add a filter" onKeyDown={(event) => event.key === 'Escape' && onCancel()}>
      <select
        aria-label="Filter field"
        value={field}
        onChange={(event) => {
          setField(event.target.value)
          if (!opsFor(event.target.value).includes(op)) setOp(opsFor(event.target.value)[0]!)
        }}
      >
        {fields.map((known) => (
          <option key={known} value={known}>
            {fieldLabel(known)}
          </option>
        ))}
      </select>
      <select aria-label="Filter rule" value={op} onChange={(event) => setOp(event.target.value as FilterOp)}>
        {ops.map((known) => (
          <option key={known} value={known}>
            {opLabel(field, known)}
          </option>
        ))}
      </select>
      {needsValue && (
        <input
          aria-label="Filter value"
          autoFocus
          placeholder={field === 'updated' || field === 'created' ? 'YYYY-MM-DD' : 'Value'}
          value={value}
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && add()}
        />
      )}
      <button type="button" className="outline-button small" onClick={add}>
        Add filter
      </button>
    </div>
  )
}
