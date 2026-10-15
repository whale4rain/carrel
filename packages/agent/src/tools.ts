import { HIT_END, HIT_START, type ProposalChange, type SearchHit } from '@carrel/core'
import type { ToolDefinition } from 'tnega/tools'

/** Results the agent gets from one search at most. */
const HITS = 8
/** Most text one read_item returns. */
const READ_LIMIT = 12_000

/** What the agent's tools may see of a project. All reads; making a *that.* only adds a pointer. */
export interface ProjectAccess {
  search(query: string): Promise<SearchHit[]>
  /** A note's text (Markdown), or a PDF's pages; `pages` is 1-based and inclusive. */
  read(itemId: string, pages?: { from: number; to: number }): Promise<ItemText>
  that(id: string): Promise<ThatText>
  /** Points at a quote on a PDF page; returns the new *that.* */
  makeThat(itemId: string, page: number, quote: string): Promise<{ id: string; label: string }>
  /** Proposes a change for the person to accept or dismiss; nothing is written until they accept. */
  propose(change: ProposalChange, why: string | undefined): Promise<{ id: string }>
}

export interface ItemText {
  title: string
  kind: string
  text: string
  /** PDFs: how many pages it has. */
  pages?: number
}

export interface ThatText {
  id: string
  item: string
  source: string
  label: string
  quote?: string
}

/** How a chip is written in an answer, so the panel can open it. */
export const chip = (that: { id: string; label: string }): string => `[${that.label || 'that.'}](that:${that.id})`

/** Carrel's tools for the agent: one project's search, reading and pointing. */
export function carrelTools(access: ProjectAccess): ToolDefinition[] {
  return [searchProjectTool(access.search), readItemTool(access), resolveThatTool(access), makeThatTool(access), proposeNoteTool(access), proposeSourceTool(access)]
}

/**
 * `search_project`: the project's search index (notes, source titles, *that.*s
 * and PDF pages), as a tnega tool. It only reads, so it needs no proposal.
 */
export function searchProjectTool(search: (query: string) => Promise<SearchHit[]>): ToolDefinition {
  return {
    schema: {
      name: 'search_project',
      description:
        "Search the person's Carrel project: their notes, the titles of their sources, the passages they pointed at (that.s) and the text of PDF pages. Use it before answering questions about what they have read or noted. Results carry the ids read_item and resolve_that take.",
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
      const query = field(input, 'query')
      if (typeof query !== 'string' || query.trim().length === 0) throw new Error('search_project needs a query')
      const hits = (await search(query)).slice(0, HITS)
      return {
        hits: hits.map((hit) => ({
          kind: hit.kind === 'that' ? 'that.' : hit.kind,
          title: hit.title,
          item: hit.itemId ?? hit.id,
          ...(hit.kind === 'that' ? { that: hit.id } : {}),
          ...(hit.page !== undefined ? { page: hit.page } : {}),
          text: hit.snippet.replaceAll(HIT_START, '').replaceAll(HIT_END, ''),
        })),
      }
    },
  }
}

function readItemTool(access: ProjectAccess): ToolDefinition {
  return {
    schema: {
      name: 'read_item',
      description: "Read a note in full, or pages of a PDF in the person's project. Web pages and videos can't be read yet.",
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'The item id, from search_project or the desk.' },
          from_page: { type: 'integer', minimum: 1, description: 'PDFs: first page to read.' },
          to_page: { type: 'integer', minimum: 1, description: 'PDFs: last page to read (at most 10 pages at once).' },
        },
        required: ['item'],
        additionalProperties: false,
      },
    },
    execute: async (input: unknown) => {
      const item = field(input, 'item')
      if (typeof item !== 'string') throw new Error('read_item needs an item id')
      const from = number(field(input, 'from_page'))
      const to = number(field(input, 'to_page'))
      const pages = from === undefined ? undefined : { from, to: Math.min(to ?? from, from + 9) }
      const read = await access.read(item, pages)
      const cut = read.text.length > READ_LIMIT
      return { ...read, text: cut ? `${read.text.slice(0, READ_LIMIT)}…` : read.text, ...(cut ? { cut: true } : {}) }
    },
  }
}

function resolveThatTool(access: ProjectAccess): ToolDefinition {
  return {
    schema: {
      name: 'resolve_that',
      description: 'What a that. points at: its source, its position, and the words it quotes.',
      parameters: {
        type: 'object',
        properties: { that: { type: 'string', description: 'The that. id.' } },
        required: ['that'],
        additionalProperties: false,
      },
    },
    execute: async (input: unknown) => {
      const id = field(input, 'that')
      if (typeof id !== 'string') throw new Error('resolve_that needs a that. id')
      const that = await access.that(id)
      return { ...that, cite: chip(that) }
    },
  }
}

function makeThatTool(access: ProjectAccess): ToolDefinition {
  return {
    schema: {
      name: 'make_that',
      description:
        'Point at exact words on a PDF page, so your answer can cite them. Returns a chip to put in your answer as written; the person can click it to open the page at those words.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'The PDF item id.' },
          page: { type: 'integer', minimum: 1 },
          quote: { type: 'string', minLength: 3, description: 'Words copied exactly from that page, a sentence at most.' },
        },
        required: ['item', 'page', 'quote'],
        additionalProperties: false,
      },
    },
    execute: async (input: unknown) => {
      const item = field(input, 'item')
      const page = number(field(input, 'page'))
      const quote = field(input, 'quote')
      if (typeof item !== 'string' || page === undefined || typeof quote !== 'string') throw new Error('make_that needs an item, a page and a quote')
      const that = await access.makeThat(item, page, quote)
      return { that: that.id, cite: chip(that) }
    },
  }
}

function proposeNoteTool(access: ProjectAccess): ToolDefinition {
  return {
    schema: {
      name: 'propose_note_edit',
      description:
        "Propose a new note, or words to add at the end of one of the person's notes. It is shown in pencil until they accept it; nothing is written before. Write Markdown in the person's voice of a study note, keep chips exactly as tools gave them, and only propose when they ask for a note or clearly want one.",
      parameters: {
        type: 'object',
        properties: {
          note: { type: 'string', description: 'The note to add to, by item id. Leave out for a new note.' },
          text: { type: 'string', minLength: 1, description: 'Markdown. A new note starts with a "# Title" line.' },
          why: { type: 'string', description: 'In a few words, why.' },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
    execute: async (input: unknown) => {
      const text = field(input, 'text')
      const note = field(input, 'note')
      const why = field(input, 'why')
      if (typeof text !== 'string' || text.trim().length === 0) throw new Error('propose_note_edit needs text')
      const change: ProposalChange = { kind: 'note', text: text.trim(), ...(typeof note === 'string' && note ? { note } : {}) }
      const made = await access.propose(change, typeof why === 'string' ? why : undefined)
      return { proposal: made.id, shown: 'in pencil, waiting for the person to accept or dismiss it' }
    },
  }
}

function proposeSourceTool(access: ProjectAccess): ToolDefinition {
  return {
    schema: {
      name: 'propose_source',
      description: 'Propose a web page or video (by its address) to add to the project. It is shown in pencil until the person accepts it. Only propose addresses you are sure of.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'An http or https address.' },
          why: { type: 'string', description: 'In a few words, why.' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
    execute: async (input: unknown) => {
      const url = field(input, 'url')
      const why = field(input, 'why')
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) throw new Error('propose_source needs an http or https address')
      const made = await access.propose({ kind: 'source', url: url.trim() }, typeof why === 'string' ? why : undefined)
      return { proposal: made.id, shown: 'in pencil, waiting for the person to accept or dismiss it' }
    },
  }
}

/** One step of the agent's work, in the words of its folded steps line. */
export function describeStep(tool: string, input: unknown): string {
  const query = field(input, 'query')
  const from = number(field(input, 'from_page'))
  const to = number(field(input, 'to_page'))
  const page = number(field(input, 'page'))
  if (tool === 'search_project' && typeof query === 'string') return `Searched for “${query}”`
  if (tool === 'read_item') return from === undefined ? 'Read a note or source' : to !== undefined && to !== from ? `Read pages ${from}–${to}` : `Read page ${from}`
  if (tool === 'resolve_that') return 'Looked at a that.'
  if (tool === 'propose_note_edit') return typeof field(input, 'note') === 'string' ? 'Proposed an addition to a note' : 'Proposed a note'
  if (tool === 'propose_source') return 'Proposed a source'
  if (tool === 'make_that') return page === undefined ? 'Pointed at a passage' : `Pointed at p.${page}`
  return `Used ${tool.replace(/_/g, ' ')}`
}

function field(input: unknown, name: string): unknown {
  return typeof input === 'object' && input !== null ? Reflect.get(input, name) : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}
