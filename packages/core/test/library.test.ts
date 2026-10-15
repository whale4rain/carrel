import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carrelRoots, Library, titleFromUrl, Workspace } from '../src/index.js'

let home: string
let workspace: Workspace
let library: Library

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-'))
  const now = (): Date => new Date('2026-10-14T12:00:00Z')
  workspace = new Workspace(carrelRoots(home), now)
  library = new Library(workspace, now)
  await workspace.createProject('Learn economics')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('Library', () => {
  it('copies a PDF into the project and remembers it', async () => {
    const pdf = join(home, 'Elasticity_of-demand.pdf')
    await writeFile(pdf, '%PDF-1.4 test')
    const item = await library.addFile('Learn economics', pdf)
    expect(item).toMatchObject({ kind: 'paper', title: 'Elasticity of demand', createdBy: 'user', source: { storage: 'stored', file: 'Elasticity_of-demand.pdf', size: 13 } })
    const stored = await library.filePath('Learn economics', item.id)
    expect(stored).toBe(join(home, 'Carrel', 'Learn economics', 'items', item.id, 'Elasticity_of-demand.pdf'))
    expect(await readFile(stored, 'utf8')).toBe('%PDF-1.4 test')
    expect((await library.list('Learn economics')).map((i) => i.id)).toEqual([item.id])
    const events = await workspace.readEvents('Learn economics')
    expect(events.at(-1)).toMatchObject({ actor: 'user', type: 'item.added', payload: { id: item.id, kind: 'paper' } })
  })

  it('remembers where a book was last read, without an event', async () => {
    const pdf = join(home, 'Supply.pdf')
    await writeFile(pdf, '%PDF-1.4 test')
    const item = await library.addFile('Learn economics', pdf)
    const events = (await workspace.readEvents('Learn economics')).length
    await library.setReadAt('Learn economics', item.id, { page: 12.4, offset: 1.5 })
    expect((await library.read('Learn economics', item.id)).readAt).toEqual({ page: 12, offset: 1 })
    expect(await workspace.readEvents('Learn economics')).toHaveLength(events)
    const page = await library.addLink('Learn economics', 'https://example.com/rent')
    await expect(library.setReadAt('Learn economics', page.id, { page: 1, offset: 0 })).rejects.toThrow(/books and papers/)
  })

  it('refuses files it cannot open', async () => {
    const text = join(home, 'notes.txt')
    await writeFile(text, 'hi')
    await expect(library.addFile('Learn economics', text)).rejects.toThrow(/Try a PDF/)
  })

  it('links web pages and videos without downloading them', async () => {
    const page = await library.addLink('Learn economics', 'https://en.wikipedia.org/wiki/Price_elasticity_of_demand')
    const video = await library.addLink('Learn economics', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ')
    expect(page).toMatchObject({ kind: 'web_page', title: 'en.wikipedia.org · Price elasticity of demand', source: { storage: 'linked' } })
    expect(video.kind).toBe('video')
    await expect(library.filePath('Learn economics', page.id)).rejects.toThrow(/linked/)
  })

  it('accepts only http and https links', async () => {
    await expect(library.addLink('Learn economics', 'file:///etc/passwd')).rejects.toThrow(/http/)
    await expect(library.addLink('Learn economics', 'not a link')).rejects.toThrow(/not a web address/)
  })

  it('names a link by its host when there is no path', () => {
    expect(titleFromUrl(new URL('https://www.example.com/'))).toBe('example.com')
  })
})

describe('Library titles', () => {
  it('renames an item and logs it once', async () => {
    const page = await library.addLink('Learn economics', 'https://example.com/rent')
    const renamed = await library.setTitle('Learn economics', page.id, '  Rent control — Example  ')
    expect(renamed.title).toBe('Rent control — Example')
    await library.setTitle('Learn economics', page.id, 'Rent control — Example')
    const events = await workspace.readEvents('Learn economics')
    expect(events.filter((event) => event.type === 'item.renamed')).toHaveLength(1)
    expect(library.snapshotPath('Learn economics', page.id)).toBe(join(home, 'Carrel', 'Learn economics', 'items', page.id, 'snapshot.png'))
  })
})
