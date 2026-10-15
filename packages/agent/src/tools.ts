import { HIT_END, HIT_START, type SearchHit } from '@carrel/core'
import type { ToolDefinition } from 'tnega/tools'

/** Results the agent gets from one search at most. */
const HITS = 8

/**
 * `search_project`: the project's search index (notes, source titles, *that.*s
 * and PDF pages), as a tnega tool. It only reads, so it needs no proposal.
 */
export function searchProjectTool(search: (query: string) => Promise<SearchHit[]>): ToolDefinition {
  return {
    schema: {
      name: 'search_project',
      description:
        "Search the person's Carrel project: their notes, the titles of their sources, the passages they pointed at (that.s) and the text of PDF pages. Use it before answering questions about what they have read or noted.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: 'Words to look for. Every word must match, so use few.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    execute: async (input: unknown) => {
      const query = typeof input === 'object' && input !== null ? Reflect.get(input, 'query') : undefined
      if (typeof query !== 'string' || query.trim().length === 0) throw new Error('search_project needs a query')
      const hits = (await search(query)).slice(0, HITS)
      return {
        hits: hits.map((hit) => ({
          kind: hit.kind === 'that' ? 'that.' : hit.kind,
          title: hit.title,
          ...(hit.page !== undefined ? { page: hit.page } : {}),
          text: hit.snippet.replaceAll(HIT_START, '').replaceAll(HIT_END, ''),
        })),
      }
    },
  }
}

/** One step of the agent's work, in the words of its folded steps line. */
export function describeStep(tool: string, input: unknown): string {
  const query = typeof input === 'object' && input !== null ? Reflect.get(input, 'query') : undefined
  if (tool === 'search_project' && typeof query === 'string') return `Searched for “${query}”`
  return `Used ${tool.replace(/_/g, ' ')}`
}
