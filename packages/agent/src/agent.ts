import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Threads, type Turn, type TurnStep, type Workspace } from '@carrel/core'
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

  constructor(options: ProjectAgentOptions) {
    this.workspace = options.workspace
    this.threads = new Threads(options.workspace, options.now)
    this.meter = new MeteredModel(options.model)
    this.tnega = new CarrelTnega({ root: this.root(), llm: this.meter.llm })
    this.tools = options.tools
  }

  turns(folder: string): Promise<Turn[]> {
    return this.threads.turns(folder)
  }

  /**
   * Asks in the project's thread. The question is kept at once; the answer
   * (or why there is none) when the agent is done.
   */
  ask(folder: string, text: string, onEvent: (event: AgentEvent) => void = () => undefined): Promise<{ question: Turn; answer: Turn }> {
    const run = this.queue.then(async () => {
      const question = await this.threads.add(folder, { by: 'user', text })
      const steps: TurnStep[] = []
      let streamed = ''
      this.meter.take()
      let reply = ''
      let error: string | undefined
      try {
        const project = await this.project(folder)
        reply = await project.ask(text, (event) => {
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
        })
      } catch (reason) {
        error = reason instanceof Error ? reason.message : String(reason)
      }
      const answer = await this.threads.add(folder, {
        by: 'agent',
        text: reply,
        ...(steps.length > 0 ? { steps } : {}),
        cost: this.meter.take(),
        ...(error !== undefined ? { error } : {}),
      })
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
