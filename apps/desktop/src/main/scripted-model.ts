import { DISTILL_MARK, RELATE_MARK } from '@carrel/memory'
import type { LLMAdapter, LLMStreamEvent } from 'tnega/agent'

/**
 * A stand-in model for checks and screenshots (`CARREL_LLM=scripted`): it
 * searches the project for the longest word of the question, then answers
 * with the first thing it found, citing a chip the question pointed at.
 * Asked to "make a note", it proposes one. No network, no key.
 */
/** What the stand-in model says a few words mean, for checks of the language kit. */
const MEANINGS: Record<string, string> = { 'la mesa': 'the table', 'el libro': 'the book', 'la ventana': 'the window' }

export function scriptedModel(): LLMAdapter {
  let call = 0
  return {
    complete: () => Promise.reject(new Error('The scripted model only streams.')),
    async *stream(messages, tools): AsyncIterable<LLMStreamEvent> {
      const id = `scripted-${call++}`
      const last = messages.at(-1)
      yield { type: 'message_start', id }
      const system = messages[0]?.role === 'system' ? messages[0].content : ''
      if (tools.length === 0 && (system.startsWith(DISTILL_MARK) || system.startsWith(RELATE_MARK))) {
        yield { type: 'message_delta', id, delta: memoryAnswer(system, last?.content ?? '') }
        yield { type: 'message_stop', id, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } }
        return
      }
      if (tools.length === 0) {
        // A learning kit's question, asked with no tools: a meaning for the quoted words.
        const words = /[“"]([^”"]+)[”"]/.exec(last?.content ?? '')?.[1]?.trim() ?? ''
        yield { type: 'message_delta', id, delta: MEANINGS[words.toLowerCase()] ?? `the meaning of “${words}” here` }
        yield { type: 'message_stop', id, finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } }
        return
      }
      if (last?.role !== 'tool') {
        const asked = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
        // The question comes after any [Context] block.
        const question = asked.split('\n\n').at(-1) ?? asked
        const query = question.split(/[^\p{L}\p{N}]+/u).sort((a, b) => b.length - a.length)[0] ?? question
        yield { type: 'message_delta', id, delta: 'Let me look in your project. ' }
        yield { type: 'toolcall_start', id, index: 0, name: 'search_project' }
        yield { type: 'toolcall_end', id, index: 0, name: 'search_project', arguments: { query } }
        yield { type: 'message_stop', id, finishReason: 'tool_calls' }
        return
      }
      const asked = messages.findLastIndex((message) => message.role === 'user')
      const results = messages.slice(asked + 1).filter((message) => message.role === 'tool')
      const hit = firstHit(results[0]?.content ?? '')
      // A chip the question pointed at is cited back, the way a real answer would.
      const question = messages[asked]?.content ?? ''
      const pointed = /\[[^\]]+\]\(that:[\w-]+\)/.exec(question.replaceAll('[that.]', ''))?.[0]
      const noting = /\bmake a note\b/i.test(question.split('\n\n').at(-1) ?? '')
      if (noting && results.length === 1) {
        const text = `# Note on ${hit?.title ?? 'that'}\n\n${hit ? hit.text.trim() : 'Nothing found yet.'}${pointed ? ` ${pointed}` : ''}`
        yield { type: 'toolcall_start', id, index: 0, name: 'propose_note_edit' }
        yield { type: 'toolcall_end', id, index: 0, name: 'propose_note_edit', arguments: { text, why: 'You asked for a note' } }
        yield { type: 'message_stop', id, finishReason: 'tool_calls' }
        return
      }
      const found = hit ? `Your ${hit.kind === 'note' ? 'note' : 'source'} “${hit.title}” says: ${hit.text.trim()}` : "I couldn't find anything about that in this project yet."
      const answer = noting ? 'I proposed a note from what I found. Accept it with Tab.' : (pointed ? `You are pointing at ${pointed}. ` : '') + found
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

/**
 * The memory engine's two prompts: one piece per capture, titled after it,
 * and a "same idea" line from each new piece to its closest older one.
 */
function memoryAnswer(system: string, user: string): string {
  if (system.startsWith(DISTILL_MARK)) {
    const pieces = [...user.matchAll(/^\[(\d+)\] \w+ from \w+: (.+)$/gm)].map(([, n, title]) => ({ title, body: `What ${title} says, in short.`, group: 'Kept', from: [Number(n)] }))
    return JSON.stringify({ pieces })
  }
  const lines = [...user.matchAll(/^New piece (\d+)[^\n]*\nOlder pieces:\n\s+(c\d+)/gm)].map(([, n, old]) => ({ new: Number(n), old, relation: 'same idea' }))
  return JSON.stringify({ lines })
}
