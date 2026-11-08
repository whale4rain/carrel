import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { agents, systemPrompt, type AgentRegistry, type LLMAdapter, type LiveAgent } from 'tnega/agent'
import { blackboardLocal } from 'tnega/blackboard-local'
import { USER_ADDRESS, agentAddress, type BoxEnvelope, type BoxPlacement, type BoxService } from 'tnega/box'
import { boxBlackboard } from 'tnega/box-blackboard'
import { Context } from 'tnega/core'
import type { ProjectRecord, ProjectsService } from 'tnega/project'
import { projectLocal } from 'tnega/project-local'
import { projectLoop } from 'tnega/project-loop'
import type { SessionEvent } from 'tnega/session'
import type { ThreadService } from 'tnega/thread'
import { threadLocal } from 'tnega/thread-local'
import { tools, type ToolDefinition, type ToolsService } from 'tnega/tools'

/**
 * Carrel's project thread is a direct study partner, not tnega's coordinator
 * that hands work to Threads, so Carrel brings its own prompt.
 */
export const CARREL_PROMPT = `You are the study partner inside Carrel, a desk for long-running study. The person lays out books, papers, videos, web pages and notes on desks, and asks you about them.

- Answer directly and briefly, in plain language. A few sentences is usually right.
- When a question is about what the person has read or noted, call search_project first, and say which note or source each point comes from, by its title and page. Use read_item to read a note or PDF pages in full.
- When they ask about something from earlier days or other projects, or how today's reading fits what came before, call recall_memory if you have it, and say which day and source each point comes from. Bring up earlier things only when they ask.
- A message may start with [Context]: the that.s the person is pointing at and what is on their desk. Answer about those first.
- Cite a passage with a that. chip, written exactly as a tool gave it, like [p.12](that:abc). Use the chip of a that. you were given, or make one with make_that on a PDF page. Never invent a chip.
- Never claim the person's work as yours. You cannot change their notes, sources or desks yourself: propose a note (propose_note_edit) or a source (propose_source), and the person accepts or dismisses it. Propose only when they ask, or clearly want it; then say in one line what you proposed.`

/** A side thread is the same partner, kept to one topic. */
export const SIDE_PROMPT = `${CARREL_PROMPT}
- This is a side thread the person opened for one topic. Stay on it; the project thread holds everything else.`

export interface CarrelProjectOptions {
  /** Folder that holds tnega's state for Carrel (in the app: ~/.carrel/agent). */
  root: string
  llm: LLMAdapter
}

/** What the UI sees while the agent answers. */
export type StreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'tool-call'; name: string; arguments: unknown }
  | { type: 'tool-result'; name: string }
  | { type: 'reply'; text: string }

export interface OpenCarrelProject {
  record: ProjectRecord
  ctx: Context
  box: BoxService
  threads: ThreadService
  registry: AgentRegistry
  tools: ToolsService
  /** Sends a message to the project thread (or a side thread, by id) and resolves with the agent's reply. */
  ask(text: string, onEvent?: (event: StreamEvent) => void, thread?: string): Promise<string>
  /** Starts a side thread: a tnega Thread under the project's coordinator. Returns its id. */
  startSide(title: string): Promise<string>
  dispose(): Promise<void>
}

/**
 * A Carrel project as a tnega Project, composed from tnega's published seams:
 * Blackboard, Box, Projects, Threads, the Agent registry, Tools and the
 * Project Loop. This is a slimmed-down version of what tnega's own
 * ProjectHost assembles, without its coordinator tool allowlist, worktrees,
 * shell or approvals.
 */
export class CarrelTnega {
  private index: { ctx: Context; projects: ProjectsService } | undefined
  private readonly options: CarrelProjectOptions

  constructor(options: CarrelProjectOptions) {
    this.options = options
  }

  async create(name: string): Promise<ProjectRecord> {
    return await (await this.projects()).create({ name })
  }

  async list(): Promise<ProjectRecord[]> {
    return await (await this.projects()).list()
  }

  /** Opens a project's thread with the Carrel tools it may call. */
  async open(projectId: string, carrelTools: readonly ToolDefinition[] = []): Promise<OpenCarrelProject> {
    const record = await (await this.projects()).get(projectId)
    if (!record) throw new Error(`project not found: ${projectId}`)
    const directory = join(this.options.root, 'projects', record.id)
    await mkdir(directory, { recursive: true })

    const ctx = new Context()
    try {
      await ctx.plugin(tools)
      await ctx.plugin(systemPrompt)
      await ctx.plugin(blackboardLocal, { root: join(directory, 'blackboard') })
      await ctx.plugin(boxBlackboard, { projectId: record.id })
      await ctx.plugin(agents)
      await ctx.plugin(threadLocal, {
        projectId: record.id,
        root: directory,
        llm: this.options.llm,
        coordinatorPrompt: CARREL_PROMPT,
        threadPrompt: SIDE_PROMPT,
        permission: 'read-only',
      })
      const toolService = ctx.get('tools') as ToolsService
      for (const definition of carrelTools) toolService.register(definition)
      const threads = ctx.get('threads') as ThreadService
      await threads.ensureRoot(record)
      // The loop delivers Box messages to the agent and publishes its replies.
      await ctx.plugin(projectLoop, { projectId: record.id, sweepIntervalMs: 0 })
    } catch (error) {
      await ctx.fiber.dispose()
      throw error
    }

    const box = ctx.get('box') as BoxService
    const threads = ctx.get('threads') as ThreadService
    const registry = ctx.get('agents') as AgentRegistry
    const toolService = ctx.get('tools') as ToolsService

    const ask = async (text: string, onEvent?: (event: StreamEvent) => void, thread?: string): Promise<string> => {
      // tnega's Project Loop delivers on an unref'd timer; hold the event loop
      // open while we wait so a headless caller (a script, a test) doesn't exit.
      const keepAlive = setInterval(() => undefined, 1000)
      const agentId = thread ?? record.coordinatorId
      if (thread !== undefined && (await threads.get(thread))?.projectId !== record.id) throw new Error('That side thread is not in this project.')
      const agent = await threads.activate(agentId)
      const stop = onEvent ? forwardStream(agent, onEvent) : () => undefined
      try {
        const placement: BoxPlacement = thread === undefined ? { kind: 'main' } : { kind: 'thread', threadId: thread }
        const reply = Promise.race([waitForReply(ctx, agentId, placement), turnFailure(agent)])
        await box.send({
          sender: USER_ADDRESS,
          recipients: [agentAddress(agentId)],
          placement,
          kind: thread === undefined ? 'user-message' : 'user-thread',
          text,
        })
        const envelope = await reply
        onEvent?.({ type: 'reply', text: envelope.text })
        return envelope.text
      } finally {
        stop()
        clearInterval(keepAlive)
      }
    }

    return {
      record,
      ctx,
      box,
      threads,
      registry,
      tools: toolService,
      ask,
      startSide: async (title) => (await threads.spawn({ parentId: record.coordinatorId, goal: title, label: title.slice(0, 60) })).id,
      dispose: () => ctx.fiber.dispose(),
    }
  }

  async dispose(): Promise<void> {
    const index = this.index
    this.index = undefined
    if (index) await index.ctx.fiber.dispose()
  }

  private async projects(): Promise<ProjectsService> {
    if (!this.index) {
      const ctx = new Context()
      await ctx.plugin(blackboardLocal, { root: join(this.options.root, 'blackboard') })
      await ctx.plugin(projectLocal, { root: join(this.options.root, 'projects') })
      this.index = { ctx, projects: ctx.get('projects') as ProjectsService }
    }
    return this.index.projects
  }
}

/** Turns the agent's Session events into the few things the UI draws. */
function forwardStream(agent: LiveAgent, onEvent: (event: StreamEvent) => void): () => void {
  return agent.ctx.on('session/event', (event: SessionEvent) => {
    const payload = event.payload as Record<string, unknown>
    if (event.type === 'assistant/chunk' && typeof payload.content === 'string' && payload.content) {
      onEvent({ type: 'chunk', text: payload.content })
    } else if (event.type === 'tool/call') {
      onEvent({ type: 'tool-call', name: String(payload.name), arguments: payload.arguments })
    } else if (event.type === 'tool/result') {
      onEvent({ type: 'tool-result', name: String(payload.name) })
    }
  })
}

/** The agent's published reply, in the main conversation or its side thread. */
function waitForReply(ctx: Context, agentId: string, placement: BoxPlacement): Promise<BoxEnvelope> {
  return new Promise((resolve) => {
    const dispose = ctx.on('box/sent', ({ envelope }: { envelope: BoxEnvelope }) => {
      if (envelope.sender.kind !== 'agent' || envelope.sender.id !== agentId) return
      if (envelope.placement.kind !== placement.kind || envelope.kind !== 'agent-reply') return
      dispose()
      resolve(envelope)
    })
  })
}

/** Rejects when the agent's turn ends in an error, so a failed request doesn't hang. */
function turnFailure(agent: LiveAgent): Promise<never> {
  return new Promise((_, reject) => {
    const dispose = agent.ctx.on('session/event', (event: SessionEvent) => {
      if (event.type !== 'turn/end') return
      const payload = event.payload as { finishReason?: string; reason?: { error?: { message?: string } } }
      if (payload.finishReason !== 'error') return
      dispose()
      reject(new Error(payload.reason?.error?.message ?? 'the agent turn failed'))
    })
  })
}
