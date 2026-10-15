/**
 * Notes are Markdown files, so they stay readable outside Carrel. The editor
 * works on a document tree (ProseMirror's JSON shape); these turn one into the
 * other. Only what the editor offers is kept: headings, paragraphs, lists,
 * quotes, line breaks, bold, italic, code, and *that.* chips, which are
 * written as links: `[p.42](that:<anchor id>)`.
 */

export interface NoteMark {
  type: 'bold' | 'italic' | 'code'
}

export type NoteInline =
  | { type: 'text'; text: string; marks?: NoteMark[] }
  | { type: 'hardBreak' }
  | { type: 'that'; attrs: { id: string; label: string } }

export type NoteBlock =
  | { type: 'paragraph'; content?: NoteInline[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3 }; content?: NoteInline[] }
  | { type: 'bulletList' | 'orderedList'; content: NoteListItem[] }
  | { type: 'blockquote'; content: NoteBlock[] }

export interface NoteListItem {
  type: 'listItem'
  content: NoteBlock[]
}

export interface NoteDoc {
  type: 'doc'
  content: NoteBlock[]
}

/** The link scheme a chip is written with. */
export const THAT_SCHEME = 'that:'

const MARK_ORDER: NoteMark['type'][] = ['code', 'bold', 'italic']
const DELIMITER: Record<NoteMark['type'], string> = { bold: '**', italic: '*', code: '`' }

// ---- Document to Markdown -------------------------------------------------

export function toMarkdown(doc: NoteDoc): string {
  const text = blocks(doc.content ?? [], '').trimEnd()
  return text.length > 0 ? `${text}\n` : ''
}

function blocks(content: readonly NoteBlock[], indent: string): string {
  // Empty lines (an untitled title, a blank paragraph) leave nothing behind.
  return content
    .map((block) => block_(block, indent))
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
}

function block_(block: NoteBlock, indent: string): string {
  switch (block.type) {
    case 'heading': {
      const text = inline(block.content ?? [], indent)
      return text.trim().length > 0 ? `${indent}${'#'.repeat(block.attrs.level)} ${text}` : ''
    }
    case 'bulletList':
    case 'orderedList':
      return block.content
        .map((item, i) => {
          const marker = block.type === 'bulletList' ? '- ' : `${i + 1}. `
          const inner = blocks(item.content, indent + ' '.repeat(marker.length))
          return `${indent}${marker}${inner.slice(indent.length + marker.length)}`
        })
        .join('\n')
    case 'blockquote':
      return blocks(block.content, '')
        .split('\n')
        .map((line) => `${indent}>${line.length > 0 ? ` ${line}` : ''}`)
        .join('\n')
    default:
      return `${indent}${startSafe(inline(block.content ?? [], indent))}`
  }
}

function inline(content: readonly NoteInline[], indent: string): string {
  let out = ''
  let open: NoteMark['type'][] = []
  // Text right after a line break starts a line, so it is escaped like one.
  let lineStart = false
  const close = (keep: number): void => {
    while (open.length > keep) out += DELIMITER[open.pop()!]
  }
  for (const node of content) {
    if (node.type !== 'text') {
      close(0)
      out += node.type === 'hardBreak' ? `\\\n${indent}` : `[${escape(node.attrs.label || 'that.')}](${THAT_SCHEME}${node.attrs.id})`
      lineStart = node.type === 'hardBreak'
      continue
    }
    const wanted = MARK_ORDER.filter((mark) => node.marks?.some((m) => m.type === mark))
    let same = 0
    while (same < open.length && open[same] === wanted[same]) same++
    close(same)
    for (const mark of wanted.slice(same)) {
      out += DELIMITER[mark]
      open.push(mark)
    }
    const text = open.includes('code') ? node.text.replace(/`/g, "'") : escape(node.text)
    out += lineStart && open.length === 0 ? startSafe(text) : text
    lineStart = false
  }
  close(0)
  open = []
  return out
}

function escape(text: string): string {
  return text.replace(/[\\*_`[\]]/g, '\\$&')
}

/** Text that would read as a heading, list or quote at the start of a line. */
function startSafe(text: string): string {
  return text.replace(/^(\s*)(#{1,6}\s|[-+>]\s|\d+[.)]\s)/, (_all, space: string, lead: string) => `${space}\\${lead}`)
}

// ---- Markdown to document -------------------------------------------------

export function fromMarkdown(markdown: string): NoteDoc {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  return { type: 'doc', content: parseBlocks(lines) }
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

function parseBlocks(lines: string[]): NoteBlock[] {
  const out: NoteBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      out.push({ type: 'heading', attrs: { level: heading[1]!.length as 1 | 2 | 3 }, content: parseInline(heading[2]!) })
      i++
      continue
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quoted.push(lines[i++]!.replace(/^\s*> ?/, ''))
      out.push({ type: 'blockquote', content: parseBlocks(quoted) })
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item) {
      const [list, next] = parseList(lines, i, item[1]!.length)
      out.push(list)
      i = next
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length && lines[i]!.trim() !== '' && !/^(#{1,3})\s/.test(lines[i]!) && !/^\s*>/.test(lines[i]!) && !LIST_ITEM.test(lines[i]!)) {
      paragraph.push(lines[i++]!.trim())
    }
    out.push(paragraphOf(paragraph))
  }
  return out
}

function parseList(lines: string[], start: number, indent: number): [NoteBlock, number] {
  const first = LIST_ITEM.exec(lines[start]!)!
  const ordered = /\d/.test(first[2]!)
  const items: NoteListItem[] = []
  let i = start
  while (i < lines.length) {
    const match = LIST_ITEM.exec(lines[i]!)
    if (!match || match[1]!.length !== indent || /\d/.test(match[2]!) !== ordered) break
    const width = indent + match[2]!.length + 1
    const body = [match[3]!]
    i++
    // The item's own lines: indented under it, or continuing its text.
    while (i < lines.length) {
      const line = lines[i]!
      if (line.trim() === '') {
        const after = lines.slice(i + 1).find((next) => next.trim() !== '')
        if (after === undefined || leading(after) < width) break
        body.push('')
        i++
        continue
      }
      if (leading(line) >= width) body.push(line.slice(width))
      else if (!LIST_ITEM.test(line) && !/^\s*>/.test(line) && !/^#{1,3}\s/.test(line)) body.push(line.trim())
      else break
      i++
    }
    items.push({ type: 'listItem', content: parseBlocks(body) })
  }
  return [{ type: ordered ? 'orderedList' : 'bulletList', content: items }, i]
}

function leading(line: string): number {
  return line.length - line.trimStart().length
}

function paragraphOf(lines: string[]): NoteBlock {
  const content: NoteInline[] = []
  lines.forEach((line, n) => {
    const broken = line.endsWith('\\') && !line.endsWith('\\\\')
    const text = broken ? line.slice(0, -1) : line
    content.push(...parseInline(text))
    if (n < lines.length - 1) content.push(broken ? { type: 'hardBreak' } : { type: 'text', text: ' ' })
  })
  return { type: 'paragraph', content: merge(content) }
}

/** Inline Markdown: escapes, `code`, **bold**, *italic*, and chips. */
export function parseInline(source: string): NoteInline[] {
  const out: NoteInline[] = []
  const marks: NoteMark['type'][] = []
  let text = ''
  const flush = (): void => {
    if (text.length === 0) return
    const active = MARK_ORDER.filter((mark) => marks.includes(mark))
    out.push(active.length > 0 ? { type: 'text', text, marks: active.map((type) => ({ type })) } : { type: 'text', text })
    text = ''
  }
  const toggle = (mark: NoteMark['type']): void => {
    flush()
    const at = marks.indexOf(mark)
    if (at >= 0) marks.splice(at, 1)
    else marks.push(mark)
  }
  let i = 0
  while (i < source.length) {
    const char = source[i]!
    if (char === '\\' && i + 1 < source.length && /[\\*_`[\]#>+\-.)]/.test(source[i + 1]!)) {
      text += source[i + 1]
      i += 2
      continue
    }
    if (char === '`') {
      const end = source.indexOf('`', i + 1)
      if (end > i) {
        toggle('code')
        text += source.slice(i + 1, end)
        toggle('code')
        i = end + 1
        continue
      }
    }
    if (char === '[') {
      const chip = /^\[((?:\\.|[^\]\\])*)\]\(that:([\w-]+)\)/.exec(source.slice(i))
      if (chip) {
        flush()
        out.push({ type: 'that', attrs: { id: chip[2]!, label: chip[1]!.replace(/\\(.)/g, '$1') } })
        i += chip[0].length
        continue
      }
    }
    if (source.startsWith('**', i) && closes(source, i, '**', marks.includes('bold'))) {
      toggle('bold')
      i += 2
      continue
    }
    if ((char === '*' || char === '_') && closes(source, i, char, marks.includes('italic'))) {
      toggle('italic')
      i += 1
      continue
    }
    text += char
    i++
  }
  flush()
  return merge(out)
}

/** A delimiter counts when it closes an open mark, or a later one closes it. */
function closes(source: string, at: number, delimiter: string, open: boolean): boolean {
  if (open) return true
  const next = source[at + delimiter.length]
  if (next === undefined || /\s/.test(next)) return false
  return source.indexOf(delimiter, at + delimiter.length + 1) > 0
}

/** Joins neighbouring text with the same marks. */
function merge(content: NoteInline[]): NoteInline[] {
  const out: NoteInline[] = []
  for (const node of content) {
    const last = out.at(-1)
    if (node.type === 'text' && last?.type === 'text' && sameMarks(last.marks, node.marks)) {
      out[out.length - 1] = { ...last, text: last.text + node.text }
    } else if (node.type !== 'text' || node.text.length > 0) {
      out.push(node)
    }
  }
  return out
}

function sameMarks(a: NoteMark[] | undefined, b: NoteMark[] | undefined): boolean {
  return (a ?? []).map((m) => m.type).join() === (b ?? []).map((m) => m.type).join()
}

/** The note's plain text, for its title and for search. */
export function plainText(doc: NoteDoc): string {
  const lines: string[] = []
  const walk = (block: NoteBlock): void => {
    if (block.type === 'paragraph' || block.type === 'heading') {
      lines.push((block.content ?? []).map((node) => (node.type === 'text' ? node.text : node.type === 'that' ? node.attrs.label : '\n')).join(''))
    } else if (block.type === 'blockquote') {
      block.content.forEach(walk)
    } else {
      block.content.forEach((item) => item.content.forEach(walk))
    }
  }
  doc.content.forEach(walk)
  return lines.join('\n')
}

/** The *that.*s a note cites, in order, each once. */
export function citedThats(doc: NoteDoc): string[] {
  const ids: string[] = []
  const walk = (block: NoteBlock): void => {
    if (block.type === 'paragraph' || block.type === 'heading') {
      for (const node of block.content ?? []) if (node.type === 'that' && !ids.includes(node.attrs.id)) ids.push(node.attrs.id)
    } else if (block.type === 'blockquote') {
      block.content.forEach(walk)
    } else {
      block.content.forEach((item) => item.content.forEach(walk))
    }
  }
  doc.content.forEach(walk)
  return ids
}

/** A #tag: a hash after a space or the start of a line, then a letter or digit. */
export const TAG = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu

/** The note's #tags, lower-cased, in order, each once. */
export function tagsOf(doc: NoteDoc): string[] {
  const tags: string[] = []
  for (const match of plainText(doc).matchAll(TAG)) {
    const tag = match[2]!.toLowerCase()
    if (!tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/** Checks a document from the renderer before it is written. */
export function isNoteDoc(value: unknown): value is NoteDoc {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Record<string, unknown>
  return doc.type === 'doc' && Array.isArray(doc.content) && doc.content.every(isBlock)
}

function isBlock(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const block = value as Record<string, unknown>
  const content = block.content
  switch (block.type) {
    case 'paragraph':
      return content === undefined || (Array.isArray(content) && content.every(isInline))
    case 'heading': {
      const level = (block.attrs as Record<string, unknown> | undefined)?.level
      return (level === 1 || level === 2 || level === 3) && (content === undefined || (Array.isArray(content) && content.every(isInline)))
    }
    case 'bulletList':
    case 'orderedList':
      return Array.isArray(content) && content.every((item) => {
        const entry = item as Record<string, unknown> | null
        return entry?.type === 'listItem' && Array.isArray(entry.content) && entry.content.every(isBlock)
      })
    case 'blockquote':
      return Array.isArray(content) && content.every(isBlock)
    default:
      return false
  }
}

function isInline(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const node = value as Record<string, unknown>
  if (node.type === 'hardBreak') return true
  if (node.type === 'that') {
    const attrs = node.attrs as Record<string, unknown> | undefined
    return typeof attrs?.id === 'string' && /^[\w-]+$/.test(attrs.id) && typeof attrs.label === 'string'
  }
  return (
    node.type === 'text' &&
    typeof node.text === 'string' &&
    (node.marks === undefined || (Array.isArray(node.marks) && node.marks.every((mark) => ['bold', 'italic', 'code'].includes((mark as { type?: string } | null)?.type ?? ''))))
  )
}
