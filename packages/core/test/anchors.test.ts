import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
})
