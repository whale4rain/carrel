import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { isMissing, readJson, writeJson } from './files.js'
import type { Workspace } from './workspace.js'

/**
 * What the agent would like to change. It never writes directly: each change
 * waits here, drawn in pencil, until the person accepts or dismisses it.
 *
 * ~/Carrel/<project>/proposals/<id>.json
 */
export type ProposalChange =
  /** A new note, or (with `note`) words added at the end of one. Markdown, chips included. */
  | { kind: 'note'; note?: string; text: string }
  /** A web page or video to add to the project's library. */
  | { kind: 'source'; url: string }

export type ProposalState = 'open' | 'accepted' | 'dismissed'

export interface Proposal {
  id: string
  change: ProposalChange
  /** In a few words, why. */
  why?: string
  /** The question that led to it, by turn id. */
  asked?: string
  /** The side thread it was asked in; the project thread when left out. */
  thread?: string
  state: ProposalState
  createdAt: string
  decidedAt?: string
  /** Once accepted: the note or source it made or changed. */
  result?: string
}

export class Proposals {
  constructor(
    private readonly workspace: Workspace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every proposal in the project, oldest first. */
  async list(folder: string): Promise<Proposal[]> {
    let names: string[]
    try {
      names = await readdir(this.dir(folder))
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const found: Proposal[] = []
    for (const name of names) {
      if (!/^[\w-]+\.json$/.test(name)) continue
      const proposal = await readJson(join(this.dir(folder), name)).catch(() => undefined)
      if (isProposal(proposal)) found.push(proposal)
    }
    return found.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async read(folder: string, id: string): Promise<Proposal> {
    const proposal = await readJson(this.file(folder, id))
    if (!isProposal(proposal)) throw new Error('That proposal is not in this project.')
    return proposal
  }

  /** The agent proposes a change; nothing else is touched. */
  async make(folder: string, change: ProposalChange, options: { why?: string; asked?: string; thread?: string } = {}): Promise<Proposal> {
    const proposal: Proposal = {
      id: randomUUID(),
      change,
      ...(options.why ? { why: options.why } : {}),
      ...(options.asked ? { asked: options.asked } : {}),
      ...(options.thread && options.thread !== 'project' ? { thread: options.thread } : {}),
      state: 'open',
      createdAt: this.now().toISOString(),
    }
    await writeJson(this.file(folder, proposal.id), proposal)
    await this.workspace.event(folder, 'agent', 'proposal.made', { id: proposal.id, kind: change.kind })
    return proposal
  }

  /**
   * The person decides. `apply` makes the change (only on accept) and returns
   * what it made; a proposal is decided once.
   */
  async decide(folder: string, id: string, state: 'accepted' | 'dismissed', apply?: (change: ProposalChange) => Promise<string>): Promise<Proposal> {
    const before = await this.read(folder, id)
    if (before.state !== 'open') throw new Error(`That proposal was already ${before.state}.`)
    const result = state === 'accepted' && apply ? await apply(before.change) : undefined
    const decided: Proposal = { ...before, state, decidedAt: this.now().toISOString(), ...(result ? { result } : {}) }
    await writeJson(this.file(folder, id), decided)
    await this.workspace.event(folder, 'user', state === 'accepted' ? 'proposal.accepted' : 'proposal.dismissed', { id, ...(result ? { result } : {}) })
    return decided
  }

  private dir(folder: string): string {
    return join(this.workspace.roots.content, folder, 'proposals')
  }

  private file(folder: string, id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`"${id}" is not a proposal.`)
    return join(this.dir(folder), `${id}.json`)
  }
}

export function isProposal(value: unknown): value is Proposal {
  if (typeof value !== 'object' || value === null) return false
  const proposal = value as Record<string, unknown>
  const change = proposal.change as Record<string, unknown> | undefined
  const changeOk =
    typeof change === 'object' &&
    change !== null &&
    ((change.kind === 'note' && typeof change.text === 'string' && (change.note === undefined || typeof change.note === 'string')) ||
      (change.kind === 'source' && typeof change.url === 'string'))
  return (
    typeof proposal.id === 'string' &&
    changeOk &&
    (proposal.state === 'open' || proposal.state === 'accepted' || proposal.state === 'dismissed') &&
    typeof proposal.createdAt === 'string'
  )
}
