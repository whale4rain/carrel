// What the renderer sees of the agent: the open project's thread, and a way to ask.
import type { Turn, TurnCost, TurnStep } from '@carrel/core'

export type { Turn, TurnCost, TurnStep }

/** Which model answers, and whether it can. */
export interface AgentStatus {
  ready: boolean
  /** "deepseek-flash", or what the person chose. */
  model: string
  /** Where its key comes from: the environment, the one saved here, or none yet. */
  key: 'env' | 'saved' | 'scripted' | 'none'
  /** Whether a key can be kept safely on this computer (the system keychain). */
  canSave: boolean
}

export interface ThreadView {
  turns: Turn[]
  /** All the thread has sent so far. */
  total: TurnCost
}

/** While the agent answers: the answer so far, or a step it took. */
export type AgentLive = { type: 'text'; text: string } | { type: 'step'; step: TurnStep }

export interface AgentApi {
  status(): Promise<AgentStatus>
  /** Keeps a model key, encrypted with the system keychain. */
  saveKey(key: string): Promise<AgentStatus>
  thread(): Promise<ThreadView>
  /** Asks in the open project's thread; resolves with the agent's turn once it is done. */
  ask(text: string): Promise<Turn>
  /** The answer as it arrives. */
  onLive(listener: (event: AgentLive) => void): () => void
}

export const agentChannels = {
  status: 'agent:status',
  saveKey: 'agent:save-key',
  thread: 'agent:thread',
  ask: 'agent:ask',
  live: 'agent:live',
} as const
