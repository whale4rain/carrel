import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carrelRoots, Proposals, Workspace } from '../src/index.js'

let home: string
let workspace: Workspace
let proposals: Proposals

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-'))
  workspace = new Workspace(carrelRoots(home))
  proposals = new Proposals(workspace, () => new Date(Date.UTC(2026, 9, 15, 9)))
  await workspace.createProject('Learn economics')
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('Proposals', () => {
  it('keeps what the agent proposes, open, without changing anything else', async () => {
    const made = await proposals.make('Learn economics', { kind: 'note', text: '# Coffee\n\nA habit.' }, { why: 'You asked for a summary', asked: 'turn-1' })
    expect(made).toMatchObject({ state: 'open', why: 'You asked for a summary', asked: 'turn-1' })
    expect(await proposals.list('Learn economics')).toEqual([made])
    expect(await readdir(join(home, 'Carrel', 'Learn economics', 'proposals'))).toEqual([`${made.id}.json`])
    const events = await workspace.readEvents('Learn economics')
    expect(events.at(-1)).toMatchObject({ actor: 'agent', type: 'proposal.made', payload: { id: made.id, kind: 'note' } })
  })

  it('applies a change only when the person accepts it, once', async () => {
    const made = await proposals.make('Learn economics', { kind: 'source', url: 'https://example.com/' })
    const applied: unknown[] = []
    const accepted = await proposals.decide('Learn economics', made.id, 'accepted', async (change) => {
      applied.push(change)
      return 'item-1'
    })
    expect(applied).toEqual([{ kind: 'source', url: 'https://example.com/' }])
    expect(accepted).toMatchObject({ state: 'accepted', result: 'item-1' })
    expect((await workspace.readEvents('Learn economics')).at(-1)).toMatchObject({ actor: 'user', type: 'proposal.accepted' })
    await expect(proposals.decide('Learn economics', made.id, 'dismissed')).rejects.toThrow('already accepted')
  })

  it('dismisses without applying', async () => {
    const made = await proposals.make('Learn economics', { kind: 'note', note: 'n1', text: 'More.' })
    let applied = false
    const dismissed = await proposals.decide('Learn economics', made.id, 'dismissed', async () => {
      applied = true
      return 'x'
    })
    expect(applied).toBe(false)
    expect(dismissed.state).toBe('dismissed')
    expect(dismissed.result).toBeUndefined()
  })

  it('refuses ids that are not proposals', async () => {
    await expect(proposals.read('Learn economics', '../x')).rejects.toThrow('not a proposal')
  })
})
