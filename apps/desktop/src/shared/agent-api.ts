// What the renderer sees of the agent: the open project's thread, and a way to ask.
import type { Proposal, ProposalChange, SideThread, Turn, TurnCost, TurnStep } from '@carrel/core'
import type { ItemView, ThatView } from './workspace-api.js'

export type { Proposal, ProposalChange, SideThread, Turn, TurnCost, TurnStep }

/** The project's ongoing thread; side threads go by their own ids. */
export const PROJECT_THREAD = 'project'

/** A change the agent proposed, drawn in pencil until you accept or dismiss it. */
export interface ProposalView extends Proposal {
  /** Additions to a note: that note's title. */
  target?: string
}

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

/** What a question is asked about: the *that.*s pointed at, and the desk in view. */
export interface AskContext {
  points: string[]
  desk?: { name: string; items: string[]; selected: string[] }
}

export interface AgentApi {
  status(): Promise<AgentStatus>
  /** Keeps a model key, encrypted with the system keychain. */
  saveKey(key: string): Promise<AgentStatus>
  /** A thread's turns: the project thread, or a side thread by id. */
  thread(thread?: string): Promise<ThreadView>
  /** The project's side threads, newest first. */
  sides(): Promise<SideThread[]>
  /** Opens a side thread for a topic. */
  startSide(title: string): Promise<SideThread>
  /** Asks in a thread of the open project (the project thread unless given); resolves with the agent's turn once it is done. */
  ask(text: string, context?: AskContext, thread?: string): Promise<Turn>
  /** The answer as it arrives. */
  onLive(listener: (event: AgentLive) => void): () => void
  /** The project's proposals, oldest first. */
  proposals(): Promise<ProposalView[]>
  /** Accept (writes it) or dismiss a proposal. Accepting gives back the note or source it made or changed. */
  decide(id: string, accept: boolean): Promise<{ proposal: ProposalView; item?: ItemView }>
  /** A proposal the agent just made. */
  onProposal(listener: (proposal: ProposalView) => void): () => void
  /** A *that.* on a turn of the thread (made once; asking again gives the same one). */
  thatTurn(turnId: string, thread?: string): Promise<ThatView>
  /** Adds a turn's words and a chip back to it to a note, or to a new note. */
  addToNote(turnId: string, noteId?: string, thread?: string): Promise<ItemView>
  /** A *that.* the agent made while answering, to show with the others. */
  onThat(listener: (that: ThatView) => void): () => void
}

export const agentChannels = {
  status: 'agent:status',
  saveKey: 'agent:save-key',
  thread: 'agent:thread',
  sides: 'agent:sides',
  startSide: 'agent:start-side',
  ask: 'agent:ask',
  live: 'agent:live',
  that: 'agent:that',
  proposals: 'agent:proposals',
  decide: 'agent:decide',
  proposal: 'agent:proposal',
  thatTurn: 'agent:that-turn',
  addToNote: 'agent:add-to-note',
} as const
