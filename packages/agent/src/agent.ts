import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_THREAD, Threads, type SideThread, type Turn, type TurnStep, type Workspace } from '@carrel/core'
import type { LLMAdapter } from 'tnega/agent'
import type { ToolDefinition } from 'tnega/tools'
import { MeteredModel } from './metered.js'
import { CarrelTnega, type OpenCarrelProject } from './tnega.js'
import { describeStep } from './tools.js'

/** What the panel draws while the agent answers. */
export type AgentEvent =
  /** The answer so far. Text written before a step folds into the steps line, so it starts again. */
  | { type: 'text'; text: string }
  | { type: 'step'; step: TurnStep }

export interface ProjectAgentOptions {
  workspace: Workspace
  /** The model to use now; asked for on every request. */
  model: () => LLMAdapter
  /** The Carrel tools the agent may call in a project. */
  tools: (folder: string) => readonly ToolDefinition[]
  now?: () => Date
}

/**
 * Each Carrel project's ongoing thread with the agent. The conversation is
 * kept twice: tnega keeps what the agent remembers (in ~/.carrel/agent), and
 * Carrel keeps every turn with its steps and cost in the project
 * (~/Carrel/<project>/threads/project.jsonl), so it outlives any runtime.
 * Turns run one at a time.
 */
export class ProjectAgent {
  private readonly workspace: Workspace
  private readonly threads: Threads
  private readonly meter: MeteredModel
  private readonly tnega: CarrelTnega
  private readonly tools: (folder: string) => readonly ToolDefinition[]
  private readonly opened = new Map<string, Promise<OpenCarrelProject>>()
  private queue: Promise<unknown> = Promise.resolve()
  /** The question being answered now, and its thread, per project. */
  private readonly answering = new Map<string, { question: string; thread: string }>()

  constructor(options: ProjectAgentOptions) {
    this.workspace = options.workspace
    this.threads = new Threads(options.workspace, options.now)
    this.meter = new MeteredModel(options.model)
    this.tnega = new CarrelTnega({ root: this.root(), llm: this.meter.llm })
    this.tools = options.tools
  }

  /** A thread's turns: the project thread's, or a side thread's by id. */
  turns(folder: string, thread: string = PROJECT_THREAD): Promise<Turn[]> {
    return this.threads.turns(folder, thread)
  }

  sides(folder: string): Promise<SideThread[]> {
    return this.threads.sides(folder)
  }

  /** Opens a side thread for a topic: a tnega Thread, kept in the project under the same id. */
  async startSide(folder: string, title: string): Promise<SideThread> {
    const project = await this.project(folder)
    return this.threads.startSide(folder, await project.startSide(title), title)
  }

  /** The question the agent is answering in a project now, by turn id, so a proposal can say what led to it. */
  asking(folder: string): string | undefined {
    return this.answering.get(folder)?.question
  }

  /** The thread the agent is answering in now. */
  askingIn(folder: string): string | undefined {
    return this.answering.get(folder)?.thread
  }

  /**
   * Asks in the project's thread. The question is kept at once; the answer
   * (or why there is none) when the agent is done. `context` goes to the
   * model before the question (what you point at, what is on the desk) but
   * the thread keeps only the question and the *that.*s it pointed at.
   */
  ask(
    folder: string,
    text: string,
    onEvent: (event: AgentEvent) => void = () => undefined,
    options: { context?: string; points?: string[]; thread?: string } = {},
  ): Promise<{ question: Turn; answer: Turn }> {
    const run = this.queue.then(async () => {
      const points = options.points?.length ? { points: options.points } : {}
      const thread = options.thread ?? PROJECT_THREAD
      if (thread !== PROJECT_THREAD && !(await this.threads.sides(folder)).some((side) => side.id === thread)) throw new Error('That side thread is not in this project.')
      const question = await this.threads.add(folder, { by: 'user', text, ...points }, thread)
      this.answering.set(folder, { question: question.id, thread })
      const sent = options.context ? `${options.context}\n\n${text}` : text
      const steps: TurnStep[] = []
      let streamed = ''
      this.meter.take()
      let reply = ''
      let error: string | undefined
      try {
        const project = await this.project(folder)
        reply = await project.ask(
          sent,
          (event) => {
            if (event.type === 'chunk') {
              streamed += event.text
              onEvent({ type: 'text', text: streamed })
            } else if (event.type === 'tool-call') {
              const step = { tool: event.name, summary: describeStep(event.name, event.arguments) }
              steps.push(step)
              streamed = ''
              onEvent({ type: 'step', step })
              onEvent({ type: 'text', text: '' })
            }
          },
          thread === PROJECT_THREAD ? undefined : thread,
        )
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason)
      } finally {
        this.answering.delete(folder)
      }
      const answer = await this.threads.add(
        folder,
        {
          by: 'agent',
          text: reply,
          ...(steps.length > 0 ? { steps } : {}),
          cost: this.meter.take(),
          ...(error !== undefined ? { error } : {}),
        },
        thread,
      )
      return { question, answer }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  async dispose(): Promise<void> {
    await this.queue
    for (const project of this.opened.values()) await (await project.catch(() => undefined))?.dispose()
    this.opened.clear()
    await this.tnega.dispose()
  }

  /** The tnega project behind a Carrel project, made the first time it is asked. */
  private project(folder: string): Promise<OpenCarrelProject> {
    let open = this.opened.get(folder)
    if (!open) {
      open = (async () => {
        const map = await this.readMap()
        let id = map[folder]
        const known = id === undefined ? undefined : (await this.tnega.list()).find((record) => record.id === id)
        if (!known) {
          id = (await this.tnega.create(folder)).id
          await this.writeMap({ ...map, [folder]: id })
        }
        return this.tnega.open(id!, this.tools(folder))
      })()
      open.catch(() => this.opened.delete(folder))
      this.opened.set(folder, open)
    }
    return open
  }

  private root(): string {
    return join(this.workspace.roots.internal, 'agent')
  }

  /** Which tnega project each Carrel project folder is (tnega names them by id). */
  private async readMap(): Promise<Record<string, string>> {
    try {
      const map = JSON.parse(await readFile(join(this.root(), 'projects.json'), 'utf8')) as unknown
      return typeof map === 'object' && map !== null ? (map as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  private async writeMap(map: Record<string, string>): Promise<void> {
    await mkdir(this.root(), { recursive: true })
    await writeFile(join(this.root(), 'projects.json'), `${JSON.stringify(map, null, 2)}\n`)
  }
}
