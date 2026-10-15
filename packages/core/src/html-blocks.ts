import { parseDocument } from 'htmlparser2'
import type { DocBlock, DocInline } from './documents.js'
import { safeHref } from './safe-href.js'

/**
 * HTML (an EPUB chapter, a Word file turned into HTML) as reading blocks.
 * Only the words and their plain structure are kept: headings, paragraphs,
 * lists, quotes, code, tables, emphasis and web links. Scripts, styles,
 * forms and pictures are dropped (a picture keeps its description).
 */

/** The parts of a parsed tree this file reads. */
interface Node {
  type: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: Node[]
}

/** Elements whose content is never read. */
const SKIP = new Set(['head', 'script', 'style', 'template', 'noscript', 'svg', 'math', 'iframe', 'object', 'embed', 'video', 'audio', 'canvas', 'form', 'button', 'select', 'textarea', 'input', 'nav'])

/** Elements that only hold other blocks. */
const CONTAINERS = new Set(['html', 'body', 'main', 'article', 'section', 'div', 'header', 'footer', 'aside', 'figure', 'figcaption', 'center', 'dl', 'dd', 'dt', 'details', 'summary', 'hgroup', 'address', 'li', 'td', 'th', 'caption'])

const BLOCKS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'pre', 'table', 'hr'])

/** Parses HTML or XHTML and reads its body (or the whole of it) as blocks. */
export function htmlToBlocks(html: string, xml = false): DocBlock[] {
  const document = parseDocument(html, { xmlMode: xml, decodeEntities: true, lowerCaseTags: true, recognizeSelfClosing: true }) as unknown as Node
  const body = find(document, 'body')
  return nodeBlocks(body?.children ?? document.children ?? [])
}

/** The first element with this name, depth first. */
export function find(node: Node, name: string): Node | undefined {
  for (const child of node.children ?? []) {
    if (child.name === name) return child
    const found = find(child, name)
    if (found) return found
  }
  return undefined
}

function nodeBlocks(nodes: readonly Node[]): DocBlock[] {
  const out: DocBlock[] = []
  let words: DocInline[] = []
  const flush = (): void => {
    const text = tidy(words)
    if (text.length > 0) out.push({ type: 'paragraph', text })
    words = []
  }
  for (const node of nodes) {
    const name = node.type === 'tag' || node.type === 'script' || node.type === 'style' ? node.name : undefined
    if (name && SKIP.has(name)) continue
    if (name && (BLOCKS.has(name) || CONTAINERS.has(name))) {
      flush()
      out.push(...elementBlocks(node, name))
    } else words.push(...inlines(node, {}))
  }
  flush()
  return out
}

function elementBlocks(node: Node, name: string): DocBlock[] {
  const children = node.children ?? []
  switch (name) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const text = tidy(children.flatMap((child) => inlines(child, {})))
      return text.length > 0 ? [{ type: 'heading', level: Number(name[1]) as 1 | 2 | 3 | 4 | 5 | 6, text }] : []
    }
    case 'p': {
      // A paragraph that holds blocks (it happens in converted files) is read as those blocks.
      if (children.some((child) => child.name && BLOCKS.has(child.name))) return nodeBlocks(children)
      const text = tidy(children.flatMap((child) => inlines(child, {})))
      return text.length > 0 ? [{ type: 'paragraph', text }] : []
    }
    case 'ul':
    case 'ol': {
      const items = children.filter((child) => child.name === 'li').map((item) => nodeBlocks(item.children ?? [])).filter((item) => item.length > 0)
      return items.length > 0 ? [{ type: 'list', ordered: name === 'ol', items }] : []
    }
    case 'blockquote': {
      const blocks = nodeBlocks(children)
      return blocks.length > 0 ? [{ type: 'quote', blocks }] : []
    }
    case 'pre': {
      const text = textOf(node).replace(/^\n/, '').replace(/\s+$/, '')
      return text ? [{ type: 'code', text }] : []
    }
    case 'table': {
      const rows = rowsOf(node)
        .map((row) => (row.children ?? []).filter((cell) => cell.name === 'td' || cell.name === 'th').map((cell) => tidy((cell.children ?? []).flatMap((child) => inlines(child, {})))))
        .filter((row) => row.length > 0)
      return rows.length > 0 ? [{ type: 'table', rows }] : []
    }
    case 'hr':
      return [{ type: 'rule' }]
    default:
      return nodeBlocks(children)
  }
}

/** A table's rows, through thead, tbody and tfoot. */
function rowsOf(node: Node): Node[] {
  return (node.children ?? []).flatMap((child) => (child.name === 'tr' ? [child] : child.name === 'thead' || child.name === 'tbody' || child.name === 'tfoot' ? rowsOf(child) : []))
}

function inlines(node: Node, marks: Omit<DocInline, 'text'>): DocInline[] {
  if (node.type === 'text') return [{ ...marks, text: (node.data ?? '').replace(/\s+/g, ' ') }]
  if (node.type !== 'tag' || !node.name || SKIP.has(node.name)) return []
  const inner = (more: Omit<DocInline, 'text'>): DocInline[] => (node.children ?? []).flatMap((child) => inlines(child, { ...marks, ...more }))
  switch (node.name) {
    case 'b':
    case 'strong':
      return inner({ bold: true })
    case 'i':
    case 'em':
    case 'cite':
    case 'dfn':
      return inner({ italic: true })
    case 'code':
    case 'kbd':
    case 'samp':
    case 'tt':
      return inner({ code: true })
    case 'a': {
      const href = safeHref(node.attribs?.href)
      return inner(href ? { href } : {})
    }
    case 'br':
      return [{ ...marks, text: ' ' }]
    case 'img': {
      const alt = node.attribs?.alt?.trim()
      return alt ? [{ ...marks, text: `[${alt}]` }] : []
    }
    case 'sup':
    case 'sub':
    case 'rt':
    case 'rp':
      // Footnote marks and ruby readings would break up the words.
      return node.name === 'sup' || node.name === 'sub' ? inner({}) : []
    default:
      return inner({})
  }
}

/** All the text in a node, as it is (for code). */
function textOf(node: Node): string {
  if (node.type === 'text') return node.data ?? ''
  if (node.name === 'br') return '\n'
  return (node.children ?? []).map(textOf).join('')
}

/** Joins runs with the same marks and trims the spaces HTML leaves around and between them. */
export function tidy(inlines: readonly DocInline[]): DocInline[] {
  const out: DocInline[] = []
  for (const inline of inlines) {
    let text = inline.text
    const last = out.at(-1)
    if ((last === undefined || last.text.endsWith(' ')) && text.startsWith(' ')) text = text.replace(/^ +/, '')
    if (text === '') continue
    if (last && last.bold === inline.bold && last.italic === inline.italic && last.code === inline.code && last.href === inline.href) last.text += text
    else out.push({ ...inline, text })
  }
  const end = out.at(-1)
  if (end) end.text = end.text.replace(/ +$/, '')
  return out.filter((inline) => inline.text !== '')
}
