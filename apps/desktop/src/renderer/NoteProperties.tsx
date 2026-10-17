import { useState, type KeyboardEvent } from 'react'
import type { PropertyValue } from '../shared/workspace-api.js'

type Kind = 'text' | 'number' | 'date' | 'checkbox' | 'list'

const KINDS: Array<{ kind: Kind; label: string }> = [
  { kind: 'text', label: 'Text' },
  { kind: 'list', label: 'List' },
  { kind: 'number', label: 'Number' },
  { kind: 'date', label: 'Date' },
  { kind: 'checkbox', label: 'Checkbox' },
]

/** Property names people reach for, offered when adding one. */
const COMMON = ['status', 'tags', 'aliases', 'next review', 'due', 'source', 'type']

/**
 * A note's properties under its title, as Notion and Obsidian show them: a
 * name on the left, its value on the right, edited in place. They are kept in
 * the note's header, so other apps read them too.
 */
export function NoteProperties({
  properties,
  onSet,
}: {
  properties: Readonly<Record<string, PropertyValue>>
  /** Sets a property; `null` takes it away. Throws with a message to show when refused. */
  onSet: (key: string, value: PropertyValue | null) => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string>()
  const set = (key: string, value: PropertyValue | null): void => {
    onSet(key, value).then(
      () => setError(undefined),
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    )
  }
  const entries = Object.entries(properties)

  return (
    <div className="note-props" aria-label="Properties">
      {entries.map(([key, value]) => (
        <div className="note-prop" key={key}>
          <span className="note-prop-name" title={key}>
            {key}
          </span>
          <PropertyField name={key} value={value} onChange={(next) => set(key, next)} />
          <button type="button" className="note-prop-remove" aria-label={`Remove ${key}`} title="Remove" onClick={() => set(key, null)}>
            ×
          </button>
        </div>
      ))}
      {adding ? (
        <AddProperty
          taken={new Set(entries.map(([key]) => key.toLowerCase()))}
          onAdd={async (key, value) => {
            await onSet(key, value)
            setAdding(false)
            setError(undefined)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="note-prop-add" onClick={() => setAdding(true)}>
          + Add a property
        </button>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function kindOf(value: PropertyValue): Kind {
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'date' : 'text'
}

/** One value, edited the way its kind is: text and numbers on Enter or leaving, dates and checkboxes at once. */
function PropertyField({ name, value, onChange }: { name: string; value: PropertyValue; onChange: (value: PropertyValue) => void }) {
  const kind = kindOf(value)
  const commit = (raw: string): void => {
    if (kind === 'number') {
      const number = Number(raw)
      if (raw.trim() !== '' && Number.isFinite(number) && number !== value) onChange(number)
    } else if (raw !== value) onChange(raw)
  }
  const enter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') {
      event.currentTarget.value = String(value)
      event.currentTarget.blur()
    }
  }
  // These change at once, before the note is written; a new value from the file starts them again.
  if (kind === 'checkbox') return <input key={String(value)} type="checkbox" className="note-prop-check" aria-label={name} defaultChecked={value === true} onChange={(event) => onChange(event.target.checked)} />
  if (kind === 'date') return <input key={String(value)} type="date" className="note-prop-value" aria-label={name} defaultValue={String(value)} onChange={(event) => event.target.value && onChange(event.target.value)} />
  if (kind === 'list') return <ListField name={name} items={value as string[]} onChange={onChange} />
  return (
    <input
      key={String(value)}
      type={kind === 'number' ? 'number' : 'text'}
      className="note-prop-value"
      aria-label={name}
      defaultValue={String(value)}
      placeholder="Empty"
      spellCheck={false}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={enter}
    />
  )
}

/** A list as chips; type and press Enter (or a comma) to add one. */
function ListField({ name, items, onChange }: { name: string; items: string[]; onChange: (value: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    // Tags are kept without their #, as Obsidian keeps them.
    const item = name.toLowerCase() === 'tags' ? draft.trim().replace(/^#/, '') : draft.trim()
    setDraft('')
    if (item && !items.includes(item)) onChange([...items, item])
  }
  return (
    <span className="note-prop-list">
      {items.map((item) => (
        <span className="note-prop-chip" key={item}>
          {item}
          <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((other) => other !== item))}>
            ×
          </button>
        </span>
      ))}
      <input
        className="note-prop-value"
        aria-label={`Add to ${name}`}
        placeholder={items.length === 0 ? 'Empty' : 'Add'}
        value={draft}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value.replace(/,/g, ''))}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            add()
          } else if (event.key === 'Backspace' && draft === '' && items.length > 0) onChange(items.slice(0, -1))
        }}
        onBlur={add}
      />
    </span>
  )
}

/** A new property: its name and kind; it starts empty (a date starts today). */
function AddProperty({ taken, onAdd, onCancel }: { taken: ReadonlySet<string>; onAdd: (key: string, value: PropertyValue) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('text')
  const [error, setError] = useState<string>()
  const offered = COMMON.filter((common) => !taken.has(common))
  const add = (): void => {
    const key = name.trim()
    if (!key) return
    if (taken.has(key.toLowerCase())) return setError(`This note already has "${key}".`)
    const chosen = key.toLowerCase() === 'tags' || key.toLowerCase() === 'aliases' ? 'list' : kind
    const today = new Date()
    const empty: PropertyValue =
      chosen === 'list'
        ? []
        : chosen === 'number'
          ? 0
          : chosen === 'checkbox'
            ? false
            : chosen === 'date'
              ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
              : ''
    onAdd(key, empty).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }
  return (
    <div className="note-prop note-prop-new">
      <input
        className="note-prop-value"
        aria-label="Property name"
        placeholder="Name"
        list="note-prop-names"
        value={name}
        autoFocus
        spellCheck={false}
        onChange={(event) => {
          setName(event.target.value)
          setError(undefined)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') add()
          if (event.key === 'Escape') onCancel()
        }}
      />
      <datalist id="note-prop-names">
        {offered.map((common) => (
          <option key={common} value={common} />
        ))}
      </datalist>
      <select className="note-prop-kind" aria-label="Kind" value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
        {KINDS.map((option) => (
          <option key={option.kind} value={option.kind}>
            {option.label}
          </option>
        ))}
      </select>
      <button type="button" className="outline-button small" onClick={add}>
        Add
      </button>
      <button type="button" className="note-prop-remove shown" aria-label="Cancel" onClick={onCancel}>
        ×
      </button>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
