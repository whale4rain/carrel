import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Anchors, carrelRoots, momentSelector, pageSelector, textSelectors, Workspace } from '../src/index.js'

let home: string
let workspace: Workspace
let anchors: Anchors

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-'))
  const now = (): Date => new Date('2026-10-14T12:00:00Z')
  workspace = new Workspace(carrelRoots(home), now)
  anchors = new Anchors(workspace, now)
  await workspace.createProject('Learn economics')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('Anchors', () => {
  it('keeps a that. on a page with its quote', async () => {
    const text = 'Demand is elastic when buyers react strongly.'
    const made = await anchors.make('Learn economics', { itemId: 'book', selectors: [pageSelector(42), ...textSelectors(text, 0, 17)], text: 'Demand is elastic' })
    expect(made).toMatchObject({ itemId: 'book', label: 'p.42', snapshot: { text: 'Demand is elastic' }, createdBy: 'user' })
    expect(await anchors.read('Learn economics', made.id)).toEqual(made)
    const events = await workspace.readEvents('Learn economics')
    expect(events.at(-1)).toMatchObject({ type: 'that.made', payload: { id: made.id, item: 'book' } })
  })

  it('keeps a video moment with its frame', async () => {
    const made = await anchors.make('Learn economics', { itemId: 'lecture', selectors: [momentSelector(754.3)], image: new Uint8Array([137, 80, 78, 71]) })
    expect(made.label).toBe('12:34')
    const image = await anchors.imagePath('Learn economics', made.id)
    expect(image).toBe(join(home, 'Carrel', 'Learn economics', 'anchors', `${made.id}.png`))
    expect([...(await readFile(image ?? ''))]).toEqual([137, 80, 78, 71])
  })

  it('lists anchors, all or by item', async () => {
    await anchors.make('Learn economics', { itemId: 'a', selectors: [pageSelector(1)] })
    await anchors.make('Learn economics', { itemId: 'b', selectors: [pageSelector(2)] })
    expect((await anchors.list('Learn economics')).length).toBe(2)
    expect((await anchors.list('Learn economics', 'b')).map((anchor) => anchor.label)).toEqual(['p.2'])
  })

  it('refuses what is not a place', async () => {
    await expect(anchors.make('Learn economics', { itemId: 'a', selectors: [] })).rejects.toThrow(/not a place/)
    await expect(anchors.make('Learn economics', { itemId: 'a', selectors: [{ type: 'CssSelector' } as never] })).rejects.toThrow(/not a place/)
  })

  it('takes away a that. nothing uses, and keeps it in removed/', async () => {
    const made = await anchors.make('Learn economics', { itemId: 'lecture', selectors: [momentSelector(10)], image: new Uint8Array([1]) })
    await anchors.remove('Learn economics', made.id)
    expect(await anchors.list('Learn economics')).toEqual([])
    const removed = join(home, 'Carrel', 'Learn economics', 'anchors', 'removed')
    expect(JSON.parse(await readFile(join(removed, `${made.id}.json`), 'utf8'))).toMatchObject({ id: made.id })
    expect([...(await readFile(join(removed, `${made.id}.png`)))]).toEqual([1])
    expect((await workspace.readEvents('Learn economics')).at(-1)).toMatchObject({ type: 'that.removed', payload: { id: made.id } })
  })

  it('keeps a that. a note, thread or kit cites, and tidies old unused ones', async () => {
    let clock = new Date('2026-10-01T12:00:00Z')
    const later = new Anchors(workspace, () => clock)
    const cited = await later.make('Learn economics', { itemId: 'book', selectors: [pageSelector(1)] })
    const unused = await later.make('Learn economics', { itemId: 'book', selectors: [pageSelector(2)] })
    const inKit = await later.make('Learn economics', { itemId: 'book', selectors: [pageSelector(3)] })
    const root = join(home, 'Carrel', 'Learn economics')
    await mkdir(join(root, 'notes', 'econ'), { recursive: true })
    await writeFile(join(root, 'notes', 'econ', 'Demand.md'), `See [p.1](that:${cited.id}).\n`)
    await mkdir(join(root, 'kits', 'language', 'store'), { recursive: true })
    await writeFile(join(root, 'kits', 'language', 'store', 'cards.json'), JSON.stringify({ docs: { a: { value: { that: { id: inKit.id } } } } }))
    await expect(later.remove('Learn economics', cited.id)).rejects.toThrow('still uses')
    clock = new Date('2026-10-05T12:00:00Z')
    expect(await later.tidy('Learn economics')).toEqual([])
    const fresh = await later.make('Learn economics', { itemId: 'book', selectors: [pageSelector(4)] })
    clock = new Date('2026-10-09T12:00:00Z')
    expect(await later.tidy('Learn economics')).toEqual([unused.id])
    expect((await later.list('Learn economics')).map((anchor) => anchor.id)).toEqual([cited.id, inKit.id, fresh.id])
  })
})
