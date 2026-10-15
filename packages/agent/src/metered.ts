import type { LLMAdapter, LLMStreamEvent } from 'tnega/agent'
import type { TurnCost } from '@carrel/core'

/**
 * Wraps a model so every request it sends is measured: its size in bytes,
 * and the tokens the provider reports. Carrel shows this as each answer's
 * cost line, so the person always sees what left their machine.
 */
export class MeteredModel {
  readonly llm: LLMAdapter
  private cost: TurnCost = { bytes: 0, calls: 0 }

  /** `model` is asked for on every request, so the model can be changed (a new key) without reopening anything. */
  constructor(model: () => LLMAdapter) {
    const measure = (messages: unknown, tools: ReadonlyArray<{ schema: unknown }>): void => {
      this.cost.calls += 1
      this.cost.bytes += Buffer.byteLength(JSON.stringify({ messages, tools: tools.map((tool) => tool.schema) }), 'utf8')
    }
    const count = (usage: { promptTokens: number; completionTokens: number } | undefined): void => {
      if (!usage) return
      this.cost.promptTokens = (this.cost.promptTokens ?? 0) + usage.promptTokens
      this.cost.completionTokens = (this.cost.completionTokens ?? 0) + usage.completionTokens
    }
    this.llm = {
      complete: async (messages, tools, options) => {
        measure(messages, tools)
        const completion = await model().complete(messages, tools, options)
        count(completion.usage)
        return completion
      },
      stream: async function* (messages, tools, options): AsyncIterable<LLMStreamEvent> {
        const inner = model()
        measure(messages, tools)
        if (!inner.stream) {
          // A model that can't stream answers in one piece.
          const completion = await inner.complete(messages, tools, options)
          count(completion.usage)
          const id = 'whole'
          yield { type: 'message_start', id }
          if (completion.content) yield { type: 'message_delta', id, delta: completion.content }
          for (const [index, call] of (completion.toolCalls ?? []).entries()) {
            yield { type: 'toolcall_start', id, index, name: call.name }
            yield { type: 'toolcall_end', id, index, name: call.name, arguments: call.arguments }
          }
          yield { type: 'message_stop', id, finishReason: completion.finishReason }
          return
        }
        for await (const event of inner.stream(messages, tools, options)) {
          if (event.type === 'message_stop') count(event.usage)
          yield event
        }
      },
    }
  }

  /** What was sent since the last call, and starts counting again. */
  take(): TurnCost {
    const cost = this.cost
    this.cost = { bytes: 0, calls: 0 }
    return cost
  }
}
