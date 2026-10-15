import { Lexer, type Token, type Tokens } from 'marked'
import { extensionOf } from './document-files.js'
import { readEpub } from './epub.js'
import { safeHref } from './safe-href.js'

export { DOCUMENT_EXTENSIONS, extensionOf, formatLabel, isDocumentFile } from './document-files.js'
export { safeHref } from './safe-href.js'

/**
 * Sources read as text rather than as pages: Markdown first, then EPUB, Word
 * and PowerPoint. Each becomes a reading document of sections (chapters, or
 * the parts between its main headings, or slides). A section plays the part a
 * page plays in a PDF: *that.*s, bookmarks, the place last read, search and the
 * agent's reading all go by section number, starting at 1.
 *
 * The blocks are plain data, never HTML, so the desk draws them as its own
 * elements and nothing in a file can run.
 */

export interface DocInline {
  text: string
  bold?: true
  italic?: true
  code?: true
  /** A link's address (http, https or mailto only). */
  href?: string
}

export type DocBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: DocInline[] }
  | { type: 'paragraph'; text: DocInline[] }
  | { type: 'list'; ordered: boolean; items: DocBlock[][] }
  | { type: 'quote'; blocks: DocBlock[] }
  | { type: 'code'; text: string }
  | { type: 'table'; rows: DocInline[][][] }
  | { type: 'rule' }

export interface DocSection {
  title: string
  blocks: DocBlock[]
}

export interface ReadingDocument {
  sections: DocSection[]
}

/** Reads a stored file's bytes as a reading document; `title` names a part before any heading. */
export async function readDocument(bytes: Uint8Array, name: string, title: string): Promise<ReadingDocument> {
  const extension = extensionOf(name)
  if (extension === '.md' || extension === '.markdown') return readMarkdown(new TextDecoder().decode(bytes), title)
  if (extension === '.epub') return readEpub(bytes, title)
  throw new Error(`Carrel can't read ${extension || 'that kind of'} files as text yet.`)
}

/** The plain text of each section, the way the desk's text has it: what search and the agent read. */
export function sectionTexts(document: ReadingDocument): string[] {
  return document.sections.map((section) => section.blocks.map(blockText).join(''))
}

/**
 * A block's text: every line of text (a heading, a paragraph, a code block,
 * a table cell) ends with a line break. The desk draws a block with that same
 * break inside it, so offsets in the desk's text and in this one agree.
 */
export function blockText(block: DocBlock): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return `${inlineText(block.text)}\n`
    case 'code':
      return `${block.text}\n`
    case 'list':
      return block.items.map((item) => item.map(blockText).join('')).join('')
    case 'quote':
      return block.blocks.map(blockText).join('')
    case 'table':
      return block.rows.flatMap((row) => row.map((cell) => `${inlineText(cell)}\n`)).join('')
    case 'rule':
      return ''
  }
}

export function inlineText(inlines: readonly DocInline[]): string {
  return inlines.map((inline) => inline.text).join('')
}

// ---- Sections ---------------------------------------------------------------

/** Blocks without headings are cut into parts of about this many blocks. */
const PART = 60

/**
 * Cuts blocks into sections at the main headings: the highest level used
 * more than once (so a lone title doesn't make one long section). Text
 * before the first of them is a section named `title`.
 */
export function sectionsOf(blocks: readonly DocBlock[], title: string): DocSection[] {
  const headings = blocks.filter((block): block is Extract<DocBlock, { type: 'heading' }> => block.type === 'heading')
  if (headings.length === 0) {
    const parts: DocSection[] = []
    for (let at = 0; at < blocks.length; at += PART) parts.push({ title: blocks.length > PART ? `${title}, part ${parts.length + 1}` : title, blocks: blocks.slice(at, at + PART) })
    return parts.length > 0 ? parts : [{ title, blocks: [] }]
  }
  const levels = [...new Set(headings.map((heading) => heading.level))].sort((a, b) => a - b)
  const level = levels.find((candidate) => headings.filter((heading) => heading.level === candidate).length > 1) ?? levels[0]!
  const sections: DocSection[] = []
  let current: DocSection = { title, blocks: [] }
  for (const block of blocks) {
    if (block.type === 'heading' && block.level <= level) {
      if (current.blocks.length > 0) sections.push(current)
      current = { title: inlineText(block.text).trim() || title, blocks: [block] }
    } else current.blocks.push(block)
  }
  if (current.blocks.length > 0) sections.push(current)
  return sections
}

// ---- Markdown ---------------------------------------------------------------

export function readMarkdown(markdown: string, title: string): ReadingDocument {
  return { sections: sectionsOf(markdownBlocks(new Lexer({ gfm: true }).lex(markdown)), title) }
}

function markdownBlocks(tokens: readonly Token[]): DocBlock[] {
  const out: DocBlock[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading
        out.push({ type: 'heading', level: Math.min(6, Math.max(1, heading.depth)) as 1 | 2 | 3 | 4 | 5 | 6, text: markdownInlines(heading.tokens) })
        break
      }
      case 'paragraph':
        out.push({ type: 'paragraph', text: markdownInlines((token as Tokens.Paragraph).tokens) })
        break
      case 'text': {
        const text = token as Tokens.Text
        out.push({ type: 'paragraph', text: text.tokens ? markdownInlines(text.tokens) : [{ text: text.text }] })
        break
      }
      case 'list': {
        const list = token as Tokens.List
        out.push({ type: 'list', ordered: list.ordered, items: list.items.map((item) => markdownBlocks(item.tokens)) })
        break
      }
      case 'blockquote':
        out.push({ type: 'quote', blocks: markdownBlocks((token as Tokens.Blockquote).tokens) })
        break
      case 'code':
        out.push({ type: 'code', text: (token as Tokens.Code).text })
        break
      case 'table': {
        const table = token as Tokens.Table
        out.push({ type: 'table', rows: [table.header.map((cell) => markdownInlines(cell.tokens)), ...table.rows.map((row) => row.map((cell) => markdownInlines(cell.tokens)))] })
        break
      }
      case 'hr':
        out.push({ type: 'rule' })
        break
      case 'html': {
        // Raw HTML is shown as its words, never as markup.
        const words = (token as Tokens.HTML).text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        if (words) out.push({ type: 'paragraph', text: [{ text: words }] })
        break
      }
    }
  }
  return out
}

function markdownInlines(tokens: readonly Token[] | undefined, marks: Omit<DocInline, 'text'> = {}): DocInline[] {
  const out: DocInline[] = []
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
        out.push(...markdownInlines((token as Tokens.Strong).tokens, { ...marks, bold: true }))
        break
      case 'em':
        out.push(...markdownInlines((token as Tokens.Em).tokens, { ...marks, italic: true }))
        break
      case 'del':
        out.push(...markdownInlines((token as Tokens.Del).tokens, marks))
        break
      case 'codespan':
        out.push({ ...marks, text: decode((token as Tokens.Codespan).text), code: true })
        break
      case 'link': {
        const link = token as Tokens.Link
        const href = safeHref(link.href)
        out.push(...markdownInlines(link.tokens, href ? { ...marks, href } : marks))
        break
      }
      case 'image': {
        const alt = (token as Tokens.Image).text
        if (alt) out.push({ ...marks, text: `[${alt}]` })
        break
      }
      case 'br':
        out.push({ ...marks, text: ' ' })
        break
      case 'text':
      case 'escape': {
        const text = token as Tokens.Text
        if (text.tokens && text.tokens.length > 0) out.push(...markdownInlines(text.tokens, marks))
        else out.push({ ...marks, text: decode(text.text) })
        break
      }
      case 'html':
        break
      default:
        if ('text' in token && typeof token.text === 'string') out.push({ ...marks, text: decode(token.text) })
    }
  }
  return merge(out)
}

/** Neighbours with the same marks become one run. */
function merge(inlines: DocInline[]): DocInline[] {
  const out: DocInline[] = []
  for (const inline of inlines) {
    if (inline.text === '') continue
    const last = out.at(-1)
    if (last && last.bold === inline.bold && last.italic === inline.italic && last.code === inline.code && last.href === inline.href) last.text += inline.text
    else out.push({ ...inline })
  }
  return out
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

/** marked escapes text for HTML; the desk wants the characters. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) return String.fromCodePoint(parseInt(name.slice(2), 16))
    if (name.startsWith('#') && name !== '#39') return String.fromCodePoint(Number(name.slice(1)))
    return ENTITIES[name] ?? whole
  })
}
