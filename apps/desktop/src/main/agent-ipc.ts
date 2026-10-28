import { carrelTools, chip, ProjectAgent } from '@carrel/agent'
import type { Workspace } from '@carrel/core'
import { totalCost } from '@carrel/core'
import { BrowserWindow, ipcMain, safeStorage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LLMAdapter } from 'tnega/agent'
import { createLlmAdapter } from 'tnega/llm'
import { agentChannels, type AgentStatus, type AskContext } from '../shared/agent-api.js'
import type { WorkspaceReply } from '../shared/workspace-api.js'
import { scriptedModel } from './scripted-model.js'
import type { ShellController } from './shell-state.js'

/** DeepSeek by default; `CARREL_LLM_BASE_URL` and `CARREL_LLM_MODEL` pick another OpenAI-compatible route. */
const BASE_URL = process.env.CARREL_LLM_BASE_URL ?? 'https://api.deepseek.com'
const MODEL = process.env.CARREL_LLM_MODEL ?? 'deepseek-flash'

/**
 * The agent in main: the open project's thread, the model and its key.
 * A key comes from `CARREL_LLM_API_KEY`, or is typed once in the panel and
 * kept in ~/.carrel/model.json, encrypted by the system keychain.
 * `CARREL_LLM=scripted` answers with a stand-in model, for checks.
 */
export function serveAgent(workspace: Workspace, controller: ShellController): { stop: () => Promise<void>; model: () => LLMAdapter; ready: Promise<void> } {
  const keyFile = join(workspace.roots.internal, 'model.json')
  const scripted = process.env.CARREL_LLM === 'scripted'
  let saved: string | undefined
  let loading: Promise<void> | undefined
  let model: LLMAdapter | undefined

  // Read once; everyone who asks waits for the same read.
  const loadKey = (): Promise<void> =>
    (loading ??= (async () => {
      try {
        const file = JSON.parse(await readFile(keyFile, 'utf8')) as { key?: unknown }
        if (typeof file.key === 'string' && safeStorage.isEncryptionAvailable()) saved = safeStorage.decryptString(Buffer.from(file.key, 'base64'))
      } catch {
        // No key kept yet.
      }
    })())
  const apiKey = (): string | undefined => process.env.CARREL_LLM_API_KEY || saved
  const status = async (): Promise<AgentStatus> => {
    await loadKey()
    const key = scripted ? 'scripted' : process.env.CARREL_LLM_API_KEY ? 'env' : saved ? 'saved' : 'none'
    return { ready: key !== 'none', model: scripted ? 'scripted' : MODEL, key, canSave: safeStorage.isEncryptionAvailable() }
  }
  const current = (): LLMAdapter => {
    if (scripted) return (model ??= scriptedModel())
    const key = apiKey()
    if (!key) throw new Error('Add a model key first.')
    return (model ??= createLlmAdapter({ baseUrl: BASE_URL, model: MODEL, apiKey: key, protocol: 'openai' }))
  }

  const agent: ProjectAgent = new ProjectAgent({
    workspace,
    model: current,
    tools: (folder) =>
      carrelTools({
        search: (query) => controller.searchIn(folder, query),
        read: (id, pages) => controller.readItem(folder, id, pages),
        that: (id) => controller.thatText(folder, id),
        makeThat: async (id, page, quote) => {
          const that = await controller.agentThat(folder, id, page, quote)
          for (const window of BrowserWindow.getAllWindows()) window.webContents.send(agentChannels.that, that)
          return that
        },
        propose: async (change, why) => {
          const asked = agent.asking(folder)
          const thread = agent.askingIn(folder)
          const proposal = await controller.propose(folder, change, { ...(why ? { why } : {}), ...(asked ? { asked } : {}), ...(thread ? { thread } : {}) })
          for (const window of BrowserWindow.getAllWindows()) window.webContents.send(agentChannels.proposal, proposal)
          return proposal
        },
      }),
  })
  controller.askForKit = async (folder, kit, question) => {
    const { answer } = await agent.askForKit(folder, kit, question)
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(agentChannels.turns)
    if (answer.error !== undefined) throw new Error(answer.error)
    return answer.text
  }
  const openFolder = async (): Promise<string> => {
    const { open } = await controller.state()
    if (!open) throw new Error('Create a project first.')
    return open.project
  }

  const handle = (channel: string, run: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<WorkspaceReply> => {
      try {
        return { value: await run(event, ...args) }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    })
  }
  handle(agentChannels.status, () => status())
  handle(agentChannels.saveKey, async (_event, key) => {
    if (typeof key !== 'string' || key.trim().length < 8) throw new Error('That does not look like a key.')
    if (!safeStorage.isEncryptionAvailable()) throw new Error("This computer can't keep a key safely. Set CARREL_LLM_API_KEY instead.")
    await writeFile(keyFile, `${JSON.stringify({ key: safeStorage.encryptString(key.trim()).toString('base64') })}\n`)
    saved = key.trim()
    model = undefined
    return status()
  })
  const threadOf = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'string') throw new Error('That is not a thread.')
    return value
  }
  handle(agentChannels.thread, async (_event, thread) => {
    const turns = await agent.turns(await openFolder(), threadOf(thread))
    return { turns, total: totalCost(turns) }
  })
  handle(agentChannels.sides, async () => agent.sides(await openFolder()))
  handle(agentChannels.startSide, async (_event, title) => {
    if (typeof title !== 'string' || title.trim().length === 0) throw new Error('Name the side thread first.')
    return agent.startSide(await openFolder(), title)
  })
  handle(agentChannels.proposals, () => controller.proposalList())
  handle(agentChannels.decide, (_event, id, accept) => controller.decideProposal(id, accept))
  handle(agentChannels.thatTurn, (_event, turnId, thread) => controller.thatTurn(turnId, threadOf(thread)))
  handle(agentChannels.addToNote, (_event, turnId, noteId, thread) => controller.addTurnToNote(turnId, noteId ?? undefined, threadOf(thread)))
  handle(agentChannels.ask, async (event, text, context, thread) => {
    if (typeof text !== 'string' || text.trim().length === 0) throw new Error('Ask something first.')
    const folder = await openFolder()
    const asked = isAskContext(context) ? context : { points: [] }
    const { answer } = await agent.ask(
      folder,
      text.trim().slice(0, 20_000),
      (live) => {
        if (!event.sender.isDestroyed()) event.sender.send(agentChannels.live, live)
      },
      { context: await contextLine(controller, folder, asked), points: asked.points, ...(threadOf(thread) ? { thread: threadOf(thread)! } : {}) },
    )
    return answer
  })
  // The saved key is read now, so the memory's evening job can use it without the agent panel being opened first.
  return { stop: () => agent.dispose(), model: current, ready: loadKey() }
}

/**
 * What the model reads before the question: the *that.*s pointed at, with
 * their words, and the desk in view. Ids are given so the tools can take them.
 */
export async function contextLine(controller: ShellController, folder: string, context: AskContext): Promise<string> {
  const lines: string[] = []
  const thats = await Promise.all(context.points.slice(0, 12).map((id) => controller.thatText(folder, id).catch(() => undefined)))
  const pointed = thats.filter((that) => that !== undefined)
  if (pointed.length > 0) {
    lines.push('Pointing at:')
    for (const that of pointed) lines.push(`- ${chip(that)} in “${that.source}” (item ${that.item})${that.quote ? `: “${that.quote.slice(0, 600)}”` : ''}`)
  }
  if (context.desk) {
    const items = new Map((await controller.items()).map((item) => [item.id, item]))
    const selected = new Set(context.desk.selected)
    const shown = context.desk.items.slice(0, 30).flatMap((id) => {
      const item = items.get(id)
      return item ? [`${item.kind} “${item.title}” (item ${id}${selected.has(id) ? ', selected' : ''})`] : []
    })
    if (shown.length > 0) lines.push(`On the desk “${context.desk.name}”: ${shown.join('; ')}.`)
  }
  return lines.length > 0 ? ['[Context]', ...lines].join('\n') : ''
}

function isAskContext(value: unknown): value is AskContext {
  if (typeof value !== 'object' || value === null) return false
  const context = value as Record<string, unknown>
  const ids = (list: unknown): boolean => Array.isArray(list) && list.every((id) => typeof id === 'string')
  const desk = context.desk as Record<string, unknown> | undefined
  return ids(context.points) && (desk === undefined || (typeof desk.name === 'string' && ids(desk.items) && ids(desk.selected)))
}
