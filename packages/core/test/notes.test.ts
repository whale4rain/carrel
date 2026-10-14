import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carrelRoots, Notes, Workspace, type NoteDoc } from '../src/index.js'

let home: string
let workspace: Workspace
let notes: Notes
let clock = 0

const words = (text: string): NoteDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-'))
  clock = 0
  const now = (): Date => new Date(Date.UTC(2026, 9, 14, 12, 0, clock++))
  workspace = new Workspace(carrelRoots(home), now)
  notes = new Notes(workspace, now)
  await workspace.createProject('Learn economics')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('Notes', () => {
  it('keeps a note as a Markdown file', async () => {
    const note = await notes.create('Learn economics')
    expect(note.title).toBe('Untitled note')
    const saved = await notes.save('Learn economics', note.id, words('Elasticity is about *how much*'))
    expect(saved.title).toBe('Elasticity is about *how much*')
    const file = await readFile(join(home, 'Carrel', 'Learn economics', 'notes', `${note.id}.md`), 'utf8')
    expect(file).toContain('title: "Elasticity is about *how much*"')
    expect(file.endsWith('---\nElasticity is about \\*how much\\*\n')).toBe(true)
    expect(await notes.read('Learn economics', note.id)).toEqual(saved)
    const events = await workspace.readEvents('Learn economics')
    expect(events.slice(-2).map((event) => event.type)).toEqual(['note.added', 'note.edited'])
  })

  it('lists notes, most recently changed first', async () => {
    const first = await notes.create('Learn economics', words('First'))
    const second = await notes.create('Learn economics', words('Second'))
    await notes.save('Learn economics', first.id, words('First, again'))
    expect((await notes.list('Learn economics')).map((note) => note.title)).toEqual(['First, again', 'Second'])
    expect(second.title).toBe('Second')
  })

  it('reads a note changed outside Carrel', async () => {
    const note = await notes.create('Learn economics', words('Before'))
    const path = join(home, 'Carrel', 'Learn economics', 'notes', `${note.id}.md`)
    const file = await readFile(path, 'utf8')
    await writeFile(path, file.replace(/Before\n$/, '# After\n\nEdited elsewhere.'))
    expect((await notes.read('Learn economics', note.id)).title).toBe('After')
  })

  it('does not write when nothing changed', async () => {
    const note = await notes.create('Learn economics', words('Same'))
    expect(await notes.save('Learn economics', note.id, words('Same'))).toEqual(note)
  })

  it('refuses ids that are not note ids', async () => {
    await expect(notes.read('Learn economics', '../project')).rejects.toThrow('is not a note id')
    await expect(notes.read('Learn economics', 'missing')).rejects.toThrow('not in this project')
  })
})
