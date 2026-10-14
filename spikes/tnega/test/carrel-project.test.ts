import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LLMAdapter, LLMStreamEvent } from 'tnega/agent'
import { CarrelTnega, type StreamEvent } from '../src/carrel-project.ts'
import { searchNotes, searchProjectTool } from '../src/carrel-tool.ts'
import { SAMPLE_NOTES } from '../src/sample-notes.ts'

/**
 * A scripted model: first turn calls search_project, second turn streams an
 * answer that quotes the tool result, in several deltas.
 */
function scriptedModel(): { llm: LLMAdapter; seenTools: string[][]; toolResults: string[] } {
  const seenTools: string[][] = []
  const toolResults: string[] = []
  let call = 0
  const llm: LLMAdapter = {
    complete: () => Promise.reject(new Error('the spike streams')),
    async *stream(messages, tools): AsyncIterable<LLMStreamEvent> {
      seenTools.push(tools.map((tool) => tool.schema.name))
      const id = `m${call}`
      call += 1
      yield { type: 'message_start', id }
      if (call === 1) {
        yield { type: 'toolcall_start', id, index: 0, name: 'search_project' }
        yield { type: 'toolcall_end', id, index: 0, name: 'search_project', arguments: { query: 'elasticity' } }
        yield { type: 'message_stop', id, finishReason: 'tool_calls' }
        return
      }
      const last = messages.at(-1)
      toolResults.push(typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content))
      for (const delta of ['Your note ', '"Elasticity, lecture 4" ', 'says insulin is inelastic.']) {
        yield { type: 'message_delta', id, delta }
      }
      yield { type: 'message_stop', id, finishReason: 'stop' }
    },
  }
  return { llm, seenTools, toolResults }
}

describe('a Carrel project as a tnega Project', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'carrel-spike-test-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('creates a project, streams an answer, and lets the agent call a Carrel tool', async () => {
    const model = scriptedModel()
    const carrel = new CarrelTnega({ root, llm: model.llm, tools: [searchProjectTool(SAMPLE_NOTES)] })
    try {
      const record = await carrel.create('Learn economics')
      expect(await carrel.list()).toEqual([expect.objectContaining({ id: record.id, name: 'Learn economics' })])

      const project = await carrel.open(record.id)
      const events: StreamEvent[] = []
      const reply = await project.ask('What did I note about elasticity?', (event) => events.push(event))
      await project.dispose()

      expect(model.seenTools[0]).toContain('search_project')
      expect(events).toContainEqual({ type: 'tool-call', name: 'search_project', arguments: { query: 'elasticity' } })
      expect(model.toolResults[0]).toContain('Elasticity, lecture 4')
      const chunks = events.filter((event) => event.type === 'chunk')
      expect(chunks.length).toBeGreaterThan(1)
      expect(reply).toBe('Your note "Elasticity, lecture 4" says insulin is inelastic.')
    } finally {
      await carrel.dispose()
    }
  })

  it('keeps the conversation after the project is reopened', async () => {
    const carrel = new CarrelTnega({ root, llm: scriptedModel().llm, tools: [searchProjectTool(SAMPLE_NOTES)] })
    try {
      const record = await carrel.create('Learn economics')
      const first = await carrel.open(record.id)
      await first.ask('What did I note about elasticity?')
      await first.dispose()

      const again = await carrel.open(record.id)
      const timeline = await again.box.timeline()
      await again.dispose()
      expect(timeline.map((envelope) => envelope.sender.kind)).toEqual(['user', 'agent'])
    } finally {
      await carrel.dispose()
    }
  })
})

describe('searchNotes', () => {
  it('ranks notes by matching words', () => {
    expect(searchNotes(SAMPLE_NOTES, 'price elasticity')[0]?.id).toBe('note-elasticity')
  })

  it('ignores very short words', () => {
    expect(searchNotes(SAMPLE_NOTES, 'a of')).toEqual([])
  })
})
