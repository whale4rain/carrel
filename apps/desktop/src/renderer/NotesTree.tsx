import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import type { ItemView } from '../shared/workspace-api.js'
import { ChevronIcon, FolderIcon, NoteIcon } from './icons.js'
import { NameField } from './NameField.js'

/** What a dragged note or folder carries. */
const NOTE_DRAG = 'application/x-carrel-note'
const FOLDER_DRAG = 'application/x-carrel-folder'

/** Folders you folded, remembered on this computer. */
const CLOSED_KEY = 'carrel.notes.closed'

export interface NotesTreeActions {
  openNote(id: string): void
  /** A new note, in a folder ("" for none). */
  createNote(folder: string): Promise<void>
  createFolder(path: string): Promise<void>
  renameFolder(from: string, to: string): Promise<void>
  moveNote(id: string, folder: string): Promise<void>
}

interface Props {
  notes: readonly ItemView[]
  /** Every folder, empty ones too. */
  folders: readonly string[]
  /** The note open in the notes view, if one is. */
  current: string | undefined
  actions: NotesTreeActions
}

interface Folder {
  path: string
  name: string
  folders: Folder[]
  notes: ItemView[]
}

/**
 * The project's notes as a tree of folders, the way Obsidian and Notion list
 * pages: folders first, then notes, each by name. Drag a note or a folder onto
 * a folder to file it there, or onto "Notes" to take it out of any folder.
 * Double-click a folder to rename it.
 */
export function NotesTree({ notes, folders, current, actions }: Props) {
  const root = treeOf(notes, folders)
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify([...closed]))
    } catch {
      // Not remembered; it still works.
    }
  }, [closed])
  // Opening a note unfolds the folders it is in.
  const currentFolder = notes.find((note) => note.id === current)?.folder ?? ''
  useEffect(() => {
    if (!currentFolder) return
    const above = currentFolder.split('/').map((_, i, parts) => parts.slice(0, i + 1).join('/'))
    setClosed((now) => (above.some((path) => now.has(path)) ? new Set([...now].filter((path) => !above.includes(path))) : now))
  }, [currentFolder])

  const [naming, setNaming] = useState<{ kind: 'folder'; in: string } | { kind: 'rename'; path: string }>()
  const [over, setOver] = useState<string>()

  const dropOn = (path: string) => ({
    onDragOver: (event: DragEvent) => {
      const types = event.dataTransfer.types
      if (!types.includes(NOTE_DRAG) && !types.includes(FOLDER_DRAG)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setOver(path)
    },
    onDragLeave: () => setOver((now) => (now === path ? undefined : now)),
    onDrop: (event: DragEvent) => {
      setOver(undefined)
      const note = event.dataTransfer.getData(NOTE_DRAG)
      const folder = event.dataTransfer.getData(FOLDER_DRAG)
      if (!note && !folder) return
      event.preventDefault()
      if (note) void actions.moveNote(note, path)
      else if (folder !== path && !path.startsWith(`${folder}/`)) void actions.renameFolder(folder, path ? `${path}/${nameOf(folder)}` : nameOf(folder))
    },
    'data-drop': over === path ? '' : undefined,
  })

  const noteRow = (note: ItemView, depth: number): ReactNode => (
    <button
      type="button"
      key={note.id}
      className="row note tree-row"
      style={{ paddingLeft: indent(depth) }}
      aria-current={note.id === current ? 'page' : undefined}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(NOTE_DRAG, note.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => actions.openNote(note.id)}
    >
      <NoteIcon />
      <span className="grow">{note.title}</span>
    </button>
  )

  const folderRows = (folder: Folder, depth: number): ReactNode => {
    const open = !closed.has(folder.path)
    const toggle = (): void => setClosed((now) => (open ? new Set([...now, folder.path]) : new Set([...now].filter((path) => path !== folder.path))))
    return (
      <div key={folder.path} className="tree-folder" role="group" aria-label={folder.name}>
        {naming?.kind === 'rename' && naming.path === folder.path ? (
          <div style={{ paddingLeft: indent(depth) }}>
            <NameField
              variant="inline"
              label="Folder name"
              placeholder="Folder name"
              submit="Rename"
              initial={folder.name}
              onSubmit={async (name) => {
                const parent = folder.path.includes('/') ? folder.path.slice(0, folder.path.lastIndexOf('/') + 1) : ''
                await actions.renameFolder(folder.path, `${parent}${name}`)
                setNaming(undefined)
              }}
              onCancel={() => setNaming(undefined)}
            />
          </div>
        ) : (
          <div className="tree-folder-row" {...dropOn(folder.path)}>
            <button
              type="button"
              className="row tree-row folder"
              style={{ paddingLeft: indent(depth) }}
              aria-expanded={open}
              title="Double-click to rename"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(FOLDER_DRAG, folder.path)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onClick={toggle}
              onDoubleClick={() => setNaming({ kind: 'rename', path: folder.path })}
            >
              <span className="tree-twisty" data-open={open || undefined}>
                <ChevronIcon />
              </span>
              <FolderIcon />
              <span className="grow">{folder.name}</span>
              <span className="count">{countOf(folder)}</span>
            </button>
            <button type="button" className="tree-add" aria-label={`New note in ${folder.name}`} title={`New note in ${folder.name}`} onClick={() => void actions.createNote(folder.path)}>
              +
            </button>
          </div>
        )}
        {open && (
          <>
            {folder.folders.map((inner) => folderRows(inner, depth + 1))}
            {folder.notes.map((note) => noteRow(note, depth + 1))}
          </>
        )}
      </div>
    )
  }

  return (
    <section className="group notes-tree" aria-label="Notes">
      <h2 className="tree-head" {...dropOn('')}>
        Notes
      </h2>
      {root.folders.map((folder) => folderRows(folder, 0))}
      {root.notes.map((note) => noteRow(note, 0))}
      {naming?.kind === 'folder' ? (
        <NameField
          variant="inline"
          label="New folder name"
          placeholder="Folder name"
          submit="Create"
          onSubmit={async (name) => {
            await actions.createFolder(name)
            setNaming(undefined)
          }}
          onCancel={() => setNaming(undefined)}
        />
      ) : (
        <div className="tree-new">
          <button type="button" className="row desk muted" onClick={() => void actions.createNote('')}>
            + New note
          </button>
          <button type="button" className="row muted" onClick={() => setNaming({ kind: 'folder', in: '' })}>
            + Folder
          </button>
        </div>
      )}
    </section>
  )
}

/** Folders first, then notes, each sorted by name as people sort files. */
function treeOf(notes: readonly ItemView[], folders: readonly string[]): Folder {
  const root: Folder = { path: '', name: '', folders: [], notes: [] }
  const byPath = new Map<string, Folder>([['', root]])
  const folderAt = (path: string): Folder => {
    const known = byPath.get(path)
    if (known) return known
    const parent = folderAt(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
    const made: Folder = { path, name: nameOf(path), folders: [], notes: [] }
    parent.folders.push(made)
    byPath.set(path, made)
    return made
  }
  for (const path of folders) folderAt(path)
  for (const note of notes) folderAt(note.folder ?? '').notes.push(note)
  const sort = (folder: Folder): void => {
    folder.folders.sort((a, b) => collator.compare(a.name, b.name))
    folder.notes.sort((a, b) => collator.compare(a.title, b.title))
    folder.folders.forEach(sort)
  }
  sort(root)
  return root
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function countOf(folder: Folder): number {
  return folder.notes.length + folder.folders.reduce((sum, inner) => sum + countOf(inner), 0)
}

function indent(depth: number): number {
  return 10 + depth * 14
}
