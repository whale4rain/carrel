import type { ToolDefinition } from 'tnega/tools'

/** A note on the desk, as the spike fakes it. Real notes live in ~/Carrel/<project>/. */
export interface SpikeNote {
  id: string
  title: string
  text: string
}

export interface SearchHit {
  id: string
  title: string
  excerpt: string
}

/** Case-insensitive word match; enough to prove the round trip, not a search engine. */
export function searchNotes(notes: readonly SpikeNote[], query: string, limit = 5): SearchHit[] {
  const words = query.toLowerCase().split(/\W+/).filter((word) => word.length > 2)
  if (words.length === 0) return []
  return notes
    .map((note) => {
      const haystack = `${note.title} ${note.text}`.toLowerCase()
      return { note, score: words.filter((word) => haystack.includes(word)).length }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ note }) => ({ id: note.id, title: note.title, excerpt: note.text.slice(0, 240) }))
}

/**
 * `search_project`, the first of Carrel's agent tools, registered as a plain
 * tnega tool. It only reads, so it needs no proposal.
 */
export function searchProjectTool(notes: readonly SpikeNote[]): ToolDefinition {
  return {
    schema: {
      name: 'search_project',
      description:
        "Search the user's Carrel project (their notes and sources) for passages about a topic. Use it before answering questions about what the user has studied.",
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: 'Words to look for.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    execute: async (input: unknown) => {
      const query = typeof input === 'object' && input !== null ? Reflect.get(input, 'query') : undefined
      if (typeof query !== 'string') throw new Error('search_project needs a query')
      return { hits: searchNotes(notes, query) }
    },
  }
}
