import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appendLine, isMissing, readJson, writeJson } from './files.js'
import type { Actor, Workspace } from './workspace.js'

/**
 * Conversations with the agent, kept by Carrel so they outlive any model or
 * runtime: one JSON line per turn in
 *
 * ~/Carrel/<project>/threads/<thread>.jsonl
 *
 * The project's ongoing thread is `project`; side threads are listed in
 * threads/side-threads.json.
 */
export const PROJECT_THREAD = 'project'

/** One thing the agent did while answering, as the folded steps line tells it. */
export interface TurnStep {
  /** The tool it called. */
  tool: string
  /** In words: "Searched for “elasticity”". */
  summary: string
}

/** What a turn sent to the model, for the cost line. */
export interface TurnCost {
  /** Bytes of requests sent to the model, all its steps together. */
  bytes: number
  /** Model calls made. */
  calls: number
  /** Tokens the provider reported, when it reported them. */
  promptTokens?: number
  completionTokens?: number
}

export interface Turn {
  id: string
  /** Who spoke: the person or the agent. */
  by: Actor
  text: string
  createdAt: string
  /** Your turns: the *that.*s you were pointing at, by id. */
  points?: string[]
  /** Agent turns: what it did first. */
  steps?: TurnStep[]
  cost?: TurnCost
  /** Agent turns that failed: why. */
  error?: string
}

export type NewTurn = Omit<Turn, 'id' | 'createdAt'>

/** A side thread: a topic that deserves its own conversation. */
export interface SideThread {
  /** Also its tnega Thread's id. */
  id: string
  title: string
  createdAt: string
}

/** Longest side thread title. */
const TITLE = 80

export class Threads {
  constructor(
    private readonly workspace: Workspace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** A thread's turns, oldest first. A line that can't be read is skipped, not fatal. */
  async turns(folder: string, thread = PROJECT_THREAD): Promise<Turn[]> {
    let text: string
    try {
      text = await readFile(this.threadFile(folder, thread), 'utf8')
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    return text.split('\n').flatMap((line) => {
      if (line.trim().length === 0) return []
      try {
        const turn = JSON.parse(line) as unknown
        return isTurn(turn) ? [turn] : []
      } catch {
        return []
      }
    })
  }

  async add(folder: string, turn: NewTurn, thread = PROJECT_THREAD): Promise<Turn> {
    const kept: Turn = { id: randomUUID(), createdAt: this.now().toISOString(), ...turn }
    await appendLine(this.threadFile(folder, thread), kept)
    await this.workspace.event(folder, turn.by, 'turn.added', { thread, turn: kept.id })
    return kept
  }

  /** The project's side threads, newest first. The project thread is not among them. */
  async sides(folder: string): Promise<SideThread[]> {
    const index = await readJson(this.indexFile(folder))
    const list = Array.isArray(index) ? index.filter(isSideThread) : []
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** Keeps a new side thread, titled in a line. */
  async startSide(folder: string, id: string, title: string): Promise<SideThread> {
    if (id === PROJECT_THREAD || !/^[\w-]+$/.test(id)) throw new Error(`"${id}" can't be a side thread.`)
    const line = title.replace(/\s+/g, ' ').trim() || 'Side thread'
    const side: SideThread = { id, title: line.length > TITLE ? `${line.slice(0, TITLE - 1).trimEnd()}…` : line, createdAt: this.now().toISOString() }
    const known = await this.sides(folder)
    await writeJson(this.indexFile(folder), [...known.filter((other) => other.id !== id), side])
    await this.workspace.event(folder, 'user', 'thread.started', { thread: id, title: side.title })
    return side
  }

  private indexFile(folder: string): string {
    return join(this.workspace.roots.content, folder, 'threads', 'side-threads.json')
  }

  private threadFile(folder: string, thread: string): string {
    if (!/^[\w-]+$/.test(thread)) throw new Error(`"${thread}" is not a thread.`)
    return join(this.workspace.roots.content, folder, 'threads', `${thread}.jsonl`)
  }
}

/** All a thread's turns cost, for the project's running total. */
export function totalCost(turns: readonly Turn[]): TurnCost {
  const total: TurnCost = { bytes: 0, calls: 0 }
  for (const turn of turns) {
    if (!turn.cost) continue
    total.bytes += turn.cost.bytes
    total.calls += turn.cost.calls
    if (turn.cost.promptTokens !== undefined) total.promptTokens = (total.promptTokens ?? 0) + turn.cost.promptTokens
    if (turn.cost.completionTokens !== undefined) total.completionTokens = (total.completionTokens ?? 0) + turn.cost.completionTokens
  }
  return total
}

function isSideThread(value: unknown): value is SideThread {
  if (typeof value !== 'object' || value === null) return false
  const side = value as Record<string, unknown>
  return typeof side.id === 'string' && typeof side.title === 'string' && typeof side.createdAt === 'string'
}

function isTurn(value: unknown): value is Turn {
  if (typeof value !== 'object' || value === null) return false
  const turn = value as Record<string, unknown>
  return typeof turn.id === 'string' && (turn.by === 'user' || turn.by === 'agent') && typeof turn.text === 'string' && typeof turn.createdAt === 'string'
}
