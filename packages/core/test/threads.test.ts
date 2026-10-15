import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carrelRoots, Threads, totalCost, Workspace } from '../src/index.js'

let home: string
let workspace: Workspace
let threads: Threads

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-'))
  workspace = new Workspace(carrelRoots(home))
  threads = new Threads(workspace, () => new Date(Date.UTC(2026, 9, 15, 9)))
  await workspace.createProject('Learn economics')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('Threads', () => {
  it('keeps the project thread as JSON lines in the project', async () => {
    expect(await threads.turns('Learn economics')).toEqual([])
    await threads.add('Learn economics', { by: 'user', text: 'Why is coffee inelastic?' })
    const answer = await threads.add('Learn economics', {
      by: 'agent',
      text: 'It is a habit.',
      steps: [{ tool: 'search_project', summary: 'Searched for “coffee”' }],
      cost: { bytes: 2048, calls: 2, promptTokens: 900, completionTokens: 40 },
    })
    const turns = await threads.turns('Learn economics')
    expect(turns.map((turn) => [turn.by, turn.text])).toEqual([
      ['user', 'Why is coffee inelastic?'],
      ['agent', 'It is a habit.'],
    ])
    expect(turns[1]).toEqual(answer)
    const file = await readFile(join(home, 'Carrel', 'Learn economics', 'threads', 'project.jsonl'), 'utf8')
    expect(file.trim().split('\n')).toHaveLength(2)
    const events = await workspace.readEvents('Learn economics')
    expect(events.slice(-2).map((event) => [event.actor, event.type])).toEqual([
      ['user', 'turn.added'],
      ['agent', 'turn.added'],
    ])
  })

  it('skips a line it cannot read', async () => {
    await threads.add('Learn economics', { by: 'user', text: 'One' })
    await appendFile(join(home, 'Carrel', 'Learn economics', 'threads', 'project.jsonl'), '{"half\n')
    await threads.add('Learn economics', { by: 'user', text: 'Two' })
    expect((await threads.turns('Learn economics')).map((turn) => turn.text)).toEqual(['One', 'Two'])
  })

  it('refuses a thread name that is not a plain id', async () => {
    await expect(threads.add('Learn economics', { by: 'user', text: 'x' }, '../escape')).rejects.toThrow('is not a thread')
  })

  it('adds up what the turns sent', () => {
    expect(
      totalCost([
        { id: 'a', by: 'agent', text: '', createdAt: '', cost: { bytes: 100, calls: 1 } },
        { id: 'b', by: 'user', text: '', createdAt: '' },
        { id: 'c', by: 'agent', text: '', createdAt: '', cost: { bytes: 50, calls: 2, promptTokens: 10, completionTokens: 5 } },
      ]),
    ).toEqual({ bytes: 150, calls: 3, promptTokens: 10, completionTokens: 5 })
  })
})
