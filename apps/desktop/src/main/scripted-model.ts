import type { LLMAdapter, LLMStreamEvent } from 'tnega/agent'

/**
 * A stand-in model for checks and screenshots (`CARREL_LLM=scripted`): it
 * searches the project for the longest word of the question, then answers
 * with the first thing it found. No network, no key.
 */
export function scriptedModel(): LLMAdapter {
  let call = 0
  return {
    complete: () => Promise.reject(new Error('The scripted model only streams.')),
    async *stream(messages): AsyncIterable<LLMStreamEvent> {
      const id = `scripted-${call++}`
      const last = messages.at(-1)
      yield { type: 'message_start', id }
      if (last?.role !== 'tool') {
        const question = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
        const query = question.split(/[^\p{L}\p{N}]+/u).sort((a, b) => b.length - a.length)[0] ?? question
        yield { type: 'message_delta', id, delta: 'Let me look in your project. ' }
        yield { type: 'toolcall_start', id, index: 0, name: 'search_project' }
        yield { type: 'toolcall_end', id, index: 0, name: 'search_project', arguments: { query } }
        yield { type: 'message_stop', id, finishReason: 'tool_calls' }
        return
      }
      const hit = firstHit(last.content)
      const answer = hit
        ? `Your ${hit.kind === 'note' ? 'note' : 'source'} “${hit.title}” says: ${hit.text.trim()}`
        : "I couldn't find anything about that in this project yet."
      for (const word of answer.split(/(?<= )/)) {
        yield { type: 'message_delta', id, delta: word }
        await new Promise((resolve) => setTimeout(resolve, 15))
      }
      yield { type: 'message_stop', id, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } }
    },
  }
}

function firstHit(content: string): { kind: string; title: string; text: string } | undefined {
  try {
    const result = JSON.parse(content) as { hits?: Array<{ kind: string; title: string; text: string }>; output?: { hits?: unknown } }
    const hits = result.hits ?? (result.output as { hits?: Array<{ kind: string; title: string; text: string }> } | undefined)?.hits
    return hits?.[0]
  } catch {
    return undefined
  }
}
