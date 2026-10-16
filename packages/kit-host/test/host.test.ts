import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { carrelRoots, Workspace } from '@carrel/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { askLines, KitHost, KitShelf, KitStore, parseManifest, ProjectKits, unanswered, type ProjectReaders } from '../src/index.js'

let home: string
let workspace: Workspace
let folder: string
let clock: number
const now = (): Date => new Date(Date.UTC(2026, 9, 16, 9, 0, clock++))

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-kit-host-'))
  clock = 0
  workspace = new Workspace(carrelRoots(home), now)
  folder = (await workspace.createProject('Spanish')).folder
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const cards = parseManifest({
  name: 'cards',
  title: 'Cards',
  sheets: [{ id: 'deck', file: 'deck.html' }],
  store: { words: { schemaVersion: 1 } },
  reads: ['thats', 'notes'],
  needs: ['speak', 'srs.schedule'],
})

describe('KitStore', () => {
  it('keeps, finds, deletes softly and brings back', async () => {
    const store = new KitStore(workspace, folder, cards, now)
    await store.set('words', 'hola', { word: 'hola', box: 1 })
    await store.set('words', 'adios', { word: 'adiós', box: 2 })
    await store.set('words', 'hola', { word: 'hola', box: 2 })
    expect(await store.get('words', 'hola')).toEqual({ word: 'hola', box: 2 })
    expect((await store.query('words', { where: { box: 2 } })).map((doc) => doc.id)).toEqual(['hola', 'adios'])
    expect(await store.query('words', { limit: 1 })).toHaveLength(1)

    await store.delete('words', 'hola')
    expect(await store.get('words', 'hola')).toBeUndefined()
    expect((await store.query('words')).map((doc) => doc.id)).toEqual(['adios'])
    expect((await store.query('words', { deleted: true })).map((doc) => doc.id)).toEqual(['hola'])
    await store.restore('words', 'hola')
    expect(await store.info('words')).toEqual({ schemaVersion: 1, count: 2 })

    // It's on disk with the project, and every change is an event.
    const again = new KitStore(workspace, folder, cards, now)
    expect(await again.get('words', 'hola')).toEqual({ word: 'hola', box: 2 })
    const events = (await readFile(join(home, 'Carrel', folder, 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => (JSON.parse(line) as { type: string }).type)
    expect(events.filter((type) => type.startsWith('kit.store.'))).toEqual(['kit.store.added', 'kit.store.added', 'kit.store.changed', 'kit.store.deleted', 'kit.store.restored'])
  })

  it('refuses what it should not keep', async () => {
    const store = new KitStore(workspace, folder, cards, now)
    await expect(store.set('phrases', 'a', 1)).rejects.toThrow('no "phrases" collection')
    await expect(store.set('words', '../x', 1)).rejects.toThrow('document id')
    await expect(store.set('words', 'a', undefined)).rejects.toThrow('Only JSON')
    await expect(store.set('words', 'a', 'x'.repeat(300 * 1024))).rejects.toThrow('at most 256 KB')
  })

  it('keeps a snapshot before a collection moves to a new schema', async () => {
    await new KitStore(workspace, folder, cards, now).set('words', 'hola', { word: 'hola' })
    const next = { ...cards, version: 2, store: { words: { schemaVersion: 2 } } }
    const store = new KitStore(workspace, folder, next, now)
    expect(await store.info('words')).toEqual({ schemaVersion: 2, movedFrom: 1, count: 1 })
    const snapshots = await readdir(join(home, 'Carrel', folder, 'kits', 'cards', 'store', 'snapshots'))
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatch(/^words\.v1\..+\.json$/)
    // Writing under the new schema ends the move.
    await store.set('words', 'hola', { text: 'hola' })
    expect(await store.info('words')).toEqual({ schemaVersion: 2, count: 1 })
  })
})

describe('permissions', () => {
  it('says what a kit asks for and remembers what was allowed', async () => {
    const kits = new ProjectKits(workspace, now)
    await kits.add(folder, cards)
    expect(askLines(unanswered(cards, (await kits.list(folder))[0]))).toEqual(['Read your that.s and the words they point at', 'Read your notes in this project', 'Read words aloud', 'Schedule reviews'])
    await kits.allow(folder, cards)
    expect(unanswered(cards, (await kits.list(folder))[0])).toEqual({ reads: [], net: [], needs: [] })
    // A new version that asks for more asks again, for the new part only.
    const more = { ...cards, version: 2, net: ['api.dictionary.example'] }
    expect(askLines(unanswered(more, (await kits.list(folder))[0]))).toEqual(['Fetch from api.dictionary.example'])
  })
})

describe('KitHost', () => {
  const readers: ProjectReaders = {
    notes: () => Promise.resolve([{ id: 'n1', title: 'Verbs', text: '# Verbs' }]),
    sources: () => Promise.resolve([{ id: 's1', kind: 'book', title: 'Gramática' }]),
    thats: () => Promise.resolve([{ id: 't1', label: 'p.3', text: 'hola', source: 'Gramática' }]),
  }

  async function host(): Promise<KitHost> {
    const root = join(home, 'kits')
    for (const manifest of [cards, { ...parseManifest({ name: 'reader', title: 'Reader', sheets: [{ id: 'page', file: 'page.html' }], store: { books: { schemaVersion: 1 } } }) }]) {
      await mkdir(join(root, manifest.name), { recursive: true })
      await writeFile(join(root, manifest.name, 'kit.json'), JSON.stringify(manifest))
    }
    return new KitHost(workspace, new KitShelf([root]), readers)
  }

  it('runs store calls for a kit in the project', async () => {
    const kits = await host()
    await expect(kits.call(folder, 'cards', 'store.get', ['words', 'hola'])).rejects.toThrow("isn't in this project")
    await new ProjectKits(workspace).add(folder, cards)
    await kits.call(folder, 'cards', 'store.set', ['words', 'hola', { word: 'hola' }])
    expect(await kits.call(folder, 'cards', 'store.get', ['words', 'hola'])).toEqual({ word: 'hola' })
    expect(await kits.call(folder, 'cards', 'store.get', ['words', 'nada'])).toBeNull()
    expect(await kits.call(folder, 'cards', 'store.query', ['words', { where: { word: 'hola' } }])).toMatchObject([{ id: 'hola' }])
    await expect(kits.call(folder, 'cards', 'store.query', ['words', 'everything'])).rejects.toThrow('Query options')
    await expect(kits.call(folder, 'cards', 'files.read', [])).rejects.toThrow('There is no kit.files.read')
  })

  it('reads the project only where the manifest asks and the person allowed', async () => {
    const kits = await host()
    const projectKits = new ProjectKits(workspace)
    await projectKits.add(folder, cards)
    await expect(kits.call(folder, 'cards', 'read', ['thats'])).rejects.toThrow("haven't allowed")
    await expect(kits.call(folder, 'cards', 'speak', ['hola'])).rejects.toThrow("haven't allowed")
    await expect(kits.call(folder, 'cards', 'read', ['sources'])).rejects.toThrow("doesn't ask to read")
    await expect(kits.call(folder, 'cards', 'agent.ask', ['?'])).rejects.toThrow("doesn't ask for agent.ask")
    await projectKits.allow(folder, cards)
    expect(await kits.call(folder, 'cards', 'read', ['thats'])).toEqual({ from: 'thats', items: [{ id: 't1', label: 'p.3', text: 'hola', source: 'Gramática' }] })
    expect(await kits.call(folder, 'cards', 'read', ['notes'])).toEqual({ from: 'notes', items: [{ id: 'n1', title: 'Verbs', text: '# Verbs' }] })
    await expect(kits.call(folder, 'cards', 'speak', ['hola'])).rejects.toThrow("isn't ready yet")
    expect(await kits.call(folder, 'cards', 'srs.schedule', [null, 'good'])).toMatchObject({ interval: 1, reps: 1 })
    await expect(kits.call(folder, 'cards', 'srs.schedule', [null, 'perfect'])).rejects.toThrow('again, hard, good or easy')
    await expect(kits.call(folder, 'cards', 'srs.schedule', [{ due: 'soon' }, 'good'])).rejects.toThrow('due as a time')
  })
})
