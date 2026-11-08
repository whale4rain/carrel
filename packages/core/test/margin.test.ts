import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carrelRoots, Margin, Workspace } from '../src/index.js'

describe('the margin', () => {
  let home: string
  let margin: Margin
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'carrel-'))
    const workspace = new Workspace(carrelRoots(home))
    await workspace.createProject('Systems')
    margin = new Margin(workspace, () => new Date('2026-11-08T10:00:00.000Z'))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('draws a line from a that. or a quote, adds to its thread, and rubs it out', async () => {
    const line = await margin.draw('Systems', { itemId: 'paper', that: 't1', entries: [{ by: 'user', text: ' Why not keep them together? ' }] })
    expect(line).toMatchObject({ itemId: 'paper', that: 't1', by: 'user', entries: [{ by: 'user', text: 'Why not keep them together?' }] })
    const answered = await margin.add('Systems', line.id, { by: 'agent', text: 'Each request would reserve room up front.', turnId: 'turn-1' })
    expect(answered.entries.map((entry) => entry.by)).toEqual(['user', 'agent'])
    const onNote = await margin.draw('Systems', { itemId: 'note', quote: 'The block table is a page table.', by: 'agent', entries: [{ by: 'agent', text: 'What does it map from?' }] })
    expect(await margin.lines('Systems', 'note')).toEqual([onNote])
    expect(JSON.parse(await readFile(join(home, 'Carrel', 'Systems', 'margin.json'), 'utf8'))).toMatchObject({ format: 1, lines: [{ id: line.id }, { id: onNote.id }] })
    await margin.erase('Systems', line.id)
    expect((await margin.lines('Systems')).map((known) => known.id)).toEqual([onNote.id])
    await expect(margin.draw('Systems', { itemId: 'paper' })).rejects.toThrow('some words')
    await expect(margin.add('Systems', line.id, { by: 'user', text: 'more' })).rejects.toThrow('no longer')
  })

  it('remembers whether the agent thinks with you in an item', async () => {
    expect(await margin.modes('Systems')).toEqual({})
    expect(await margin.setMode('Systems', 'note', 'with')).toEqual({ note: 'with' })
    expect(await margin.setMode('Systems', 'note', 'ask')).toEqual({ note: 'ask' })
    await expect(margin.setMode('Systems', 'note', 'loud' as never)).rejects.toThrow('thinks with you')
  })
})
