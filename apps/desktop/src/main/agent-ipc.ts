import { ProjectAgent, searchProjectTool } from '@carrel/agent'
import type { Workspace } from '@carrel/core'
import { totalCost } from '@carrel/core'
import { ipcMain, safeStorage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LLMAdapter } from 'tnega/agent'
import { createLlmAdapter } from 'tnega/llm'
import { agentChannels, type AgentStatus } from '../shared/agent-api.js'
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
export function serveAgent(workspace: Workspace, controller: ShellController): () => Promise<void> {
  const keyFile = join(workspace.roots.internal, 'model.json')
  const scripted = process.env.CARREL_LLM === 'scripted'
  let saved: string | undefined
  let loaded = false
  let model: LLMAdapter | undefined

  const loadKey = async (): Promise<void> => {
    if (loaded) return
    loaded = true
    try {
      const file = JSON.parse(await readFile(keyFile, 'utf8')) as { key?: unknown }
      if (typeof file.key === 'string' && safeStorage.isEncryptionAvailable()) saved = safeStorage.decryptString(Buffer.from(file.key, 'base64'))
    } catch {
      // No key kept yet.
    }
  }
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

  const agent = new ProjectAgent({
    workspace,
    model: current,
    tools: (folder) => [searchProjectTool((query) => controller.searchIn(folder, query))],
  })
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
  handle(agentChannels.thread, async () => {
    const turns = await agent.turns(await openFolder())
    return { turns, total: totalCost(turns) }
  })
  handle(agentChannels.ask, async (event, text) => {
    if (typeof text !== 'string' || text.trim().length === 0) throw new Error('Ask something first.')
    const folder = await openFolder()
    const { answer } = await agent.ask(folder, text.trim().slice(0, 20_000), (live) => {
      if (!event.sender.isDestroyed()) event.sender.send(agentChannels.live, live)
    })
    return answer
  })
  return () => agent.dispose()
}
