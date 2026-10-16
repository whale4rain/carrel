import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carrelRoots, cleanFolder, fileName, Notes, Workspace, type NoteDoc } from '../src/index.js'

let home: string
let workspace: Workspace
let notes: Notes
let clock = 0

const dir = (): string => join(home, 'Carrel', 'Learn economics', 'notes')
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
    expect(await readdir(dir())).toEqual(['Elasticity is about how much.md'])
    const file = await readFile(join(dir(), 'Elasticity is about how much.md'), 'utf8')
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
    const path = join(dir(), 'Before.md')
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

  it('names files by title, and renames them when the title changes', async () => {
    const one = await notes.create('Learn economics', words('Elasticity'))
    const two = await notes.create('Learn economics', words('elasticity'))
    expect((await readdir(dir())).sort()).toEqual(['Elasticity.md', 'elasticity 2.md'])
    await notes.save('Learn economics', one.id, words('Price ceilings'))
    expect((await readdir(dir())).sort()).toEqual(['Price ceilings.md', 'elasticity 2.md'])
    // Its own name stays its own: no "2" for saving the same title again.
    await notes.save('Learn economics', two.id, words('elasticity\n\nmore'))
    expect((await readdir(dir())).sort()).toEqual(['Price ceilings.md', 'elasticity 2.md'])
    expect((await notes.read('Learn economics', one.id)).title).toBe('Price ceilings')
  })

  it('files notes in folders, and moves them', async () => {
    const note = await notes.create('Learn economics', words('Elasticity'), 'user', 'Micro/Demand')
    expect(note.folder).toBe('Micro/Demand')
    expect(await readdir(join(dir(), 'Micro', 'Demand'))).toEqual(['Elasticity.md'])
    await notes.createFolder('Learn economics', 'Reading')
    expect(await notes.folders('Learn economics')).toEqual(['Micro', 'Micro/Demand', 'Reading'])
    const moved = await notes.move('Learn economics', note.id, 'Reading')
    expect(moved.folder).toBe('Reading')
    expect((await notes.list('Learn economics'))[0]!.folder).toBe('Reading')
    await notes.renameFolder('Learn economics', 'Reading', 'Reading notes')
    expect((await notes.read('Learn economics', note.id)).folder).toBe('Reading notes')
    await expect(notes.renameFolder('Learn economics', 'Micro', 'Reading notes')).rejects.toThrow('already a folder')
    await expect(notes.renameFolder('Learn economics', 'Micro', 'Micro/Inner')).rejects.toThrow('inside itself')
    const events = await workspace.readEvents('Learn economics')
    expect(events.map((event) => event.type)).toContain('note.moved')
  })

  it('takes in Markdown files put there by other apps, keeping their properties', async () => {
    await mkdir(join(dir(), 'Imported'), { recursive: true })
    await writeFile(join(dir(), 'Imported', 'Consumer surplus.md'), '---\naliases:\n  - surplus\nstatus: learning\n---\n# Consumer surplus\n\nWhat buyers gain.\n')
    await mkdir(join(dir(), '.obsidian'))
    await writeFile(join(dir(), '.obsidian', 'workspace.md'), 'not a note')
    const [found] = await notes.list('Learn economics')
    expect(found).toMatchObject({ title: 'Consumer surplus', folder: 'Imported' })
    const saved = await notes.save('Learn economics', found!.id, words('Consumer surplus, again'))
    expect(saved.title).toBe('Consumer surplus, again')
    const file = await readFile(join(dir(), 'Imported', 'Consumer surplus, again.md'), 'utf8')
    expect(file).toContain(`id: ${found!.id}`)
    expect(file).toContain('aliases:\n  - surplus\nstatus: learning\n---')
  })

  it('renames notes saved under their ids to their titles', async () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
    await mkdir(dir(), { recursive: true })
    await writeFile(join(dir(), `${id}.md`), `---\nid: ${id}\ntitle: "Old note"\ncreated: 2026-10-01T00:00:00.000Z\nupdated: 2026-10-01T00:00:00.000Z\n---\nOld note\n`)
    expect((await notes.list('Learn economics')).map((note) => note.id)).toEqual([id])
    expect(await readdir(dir())).toEqual(['Old note.md'])
    expect((await notes.read('Learn economics', id)).title).toBe('Old note')
  })

  it('finds a note moved outside Carrel', async () => {
    const note = await notes.create('Learn economics', words('Wanderer'))
    await mkdir(join(dir(), 'Elsewhere'))
    const text = await readFile(join(dir(), 'Wanderer.md'), 'utf8')
    await rm(join(dir(), 'Wanderer.md'))
    await writeFile(join(dir(), 'Elsewhere', 'Wanderer.md'), text)
    expect((await notes.read('Learn economics', note.id)).folder).toBe('Elsewhere')
  })
})

describe('file and folder names', () => {
  it('makes titles safe file names', () => {
    expect(fileName('What is p/q? A "ratio": #econ')).toBe('What is p q A ratio econ')
    expect(fileName('...')).toBe('Untitled note')
    expect(fileName('CON')).toBe('CON note')
    expect(fileName('x'.repeat(300))).toHaveLength(100)
  })

  it('checks folder paths', () => {
    expect(cleanFolder('Micro/ Demand /')).toBe('Micro/Demand')
    expect(cleanFolder('')).toBe('')
    expect(() => cleanFolder('../x')).toThrow("can't be a folder name")
    expect(() => cleanFolder('.obsidian')).toThrow("can't be a folder name")
  })
})
