import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { carrelRoots, Workspace, type SearchHit } from '@carrel/core'
import type { LLMAdapter, LLMStreamEvent } from 'tnega/agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { describeStep, ProjectAgent, searchProjectTool, type AgentEvent } from '../src/index.js'

/** A scripted model: the first request searches, the next answers in pieces. */
function scriptedModel(): { llm: LLMAdapter; seen: { tools: string[][]; toolResults: string[] } } {
  const seen = { tools: [] as string[][], toolResults: [] as string[] }
  let call = 0
  const llm: LLMAdapter = {
    complete: () => Promise.reject(new Error('Carrel streams')),
    async *stream(messages, tools): AsyncIterable<LLMStreamEvent> {
      seen.tools.push(tools.map((tool) => tool.schema.name))
      const id = `m${call}`
      call += 1
      yield { type: 'message_start', id }
      if (call % 2 === 1) {
        yield { type: 'message_delta', id, delta: 'Let me look. ' }
        yield { type: 'toolcall_start', id, index: 0, name: 'search_project' }
        yield { type: 'toolcall_end', id, index: 0, name: 'search_project', arguments: { query: 'elasticity' } }
        yield { type: 'message_stop', id, finishReason: 'tool_calls', usage: { promptTokens: 100, completionTokens: 10 } }
        return
      }
      const last = messages.at(-1)
      seen.toolResults.push(typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content))
      for (const delta of ['Your note ', '“Elasticity” ', 'says coffee is inelastic.']) yield { type: 'message_delta', id, delta }
      yield { type: 'message_stop', id, finishReason: 'stop', usage: { promptTokens: 200, completionTokens: 20 } }
    },
  }
  return { llm, seen }
}

const failing: LLMAdapter = {
  complete: () => Promise.reject(new Error('no key')),
  // eslint-disable-next-line require-yield
  async *stream(): AsyncIterable<LLMStreamEvent> {
    throw new Error('The model said: 401 no key')
  },
}

const hits: SearchHit[] = [{ kind: 'note', id: 'n1', title: 'Elasticity', snippet: 'Coffee is a \u0001habit\u0002' }]

let home: string
let workspace: Workspace

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-agent-'))
  workspace = new Workspace(carrelRoots(home))
  await workspace.createProject('Learn economics')
})

afterEach(async () => {
  // On Windows, tnega may still be flushing a file as the test ends.
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('ProjectAgent', () => {
  it('answers in the project thread, searching first, and keeps both turns with steps and cost', async () => {
    const model = scriptedModel()
    const asked: Array<string | undefined> = []
    const agent: ProjectAgent = new ProjectAgent({
      workspace,
      model: () => model.llm,
      tools: (folder) => [
        searchProjectTool(async () => {
          asked.push(agent.asking(folder))
          return hits
        }),
      ],
    })
    try {
      const events: AgentEvent[] = []
      const { question, answer } = await agent.ask('Learn economics', 'What did I note about elasticity?', (event) => events.push(event))
      expect(question).toMatchObject({ by: 'user', text: 'What did I note about elasticity?' })
      expect(answer).toMatchObject({
        by: 'agent',
        text: 'Your note “Elasticity” says coffee is inelastic.',
        steps: [{ tool: 'search_project', summary: 'Searched for “elasticity”' }],
        cost: { calls: 2, promptTokens: 300, completionTokens: 30 },
      })
      expect(answer.cost?.bytes).toBeGreaterThan(500)
      expect(model.seen.tools[0]).toContain('search_project')
      expect(model.seen.toolResults[0]).toContain('Coffee is a habit')
      // The words before the search fold into the steps line; the answer streams in pieces after it.
      const texts = events.flatMap((event) => (event.type === 'text' ? [event.text] : []))
      expect(texts).toContain('Let me look. ')
      expect(texts.slice(texts.lastIndexOf(''))).toEqual(['', 'Your note ', 'Your note “Elasticity” ', 'Your note “Elasticity” says coffee is inelastic.'])
      expect((await agent.turns('Learn economics')).map((turn) => turn.by)).toEqual(['user', 'agent'])
      // Tools know which question they answer (proposals keep it); only while it is answered.
      expect(asked).toEqual([question.id])
      expect(agent.asking('Learn economics')).toBeUndefined()
    } finally {
      await agent.dispose()
    }
  })

  it('comes back to the same tnega project after a restart', async () => {
    const one = scriptedModel().llm
    const first = new ProjectAgent({ workspace, model: () => one, tools: () => [] })
    await first.ask('Learn economics', 'Hello')
    await first.dispose()
    const map = JSON.parse(await readFile(join(home, '.carrel', 'agent', 'projects.json'), 'utf8')) as Record<string, string>
    const two = scriptedModel().llm
    const second = new ProjectAgent({ workspace, model: () => two, tools: () => [] })
    try {
      await second.ask('Learn economics', 'Again')
      expect(JSON.parse(await readFile(join(home, '.carrel', 'agent', 'projects.json'), 'utf8'))).toEqual(map)
      expect(await second.turns('Learn economics')).toHaveLength(4)
    } finally {
      await second.dispose()
    }
  })

  it('keeps a failed answer with the reason, and stays usable', async () => {
    let model = failing
    const agent = new ProjectAgent({ workspace, model: () => model, tools: () => [] })
    try {
      const { answer } = await agent.ask('Learn economics', 'Hello?')
      expect(answer.text).toBe('')
      expect(answer.error).toContain('401 no key')
      model = scriptedModel().llm
      expect((await agent.ask('Learn economics', 'And now?')).answer.error).toBeUndefined()
    } finally {
      await agent.dispose()
    }
  })
})

describe('describeStep', () => {
  it('says what a step did', () => {
    expect(describeStep('search_project', { query: 'price' })).toBe('Searched for “price”')
    expect(describeStep('point_somewhere', {})).toBe('Used point somewhere')
  })
})
