import { unzipSync } from 'fflate'
import { parseDocument } from 'htmlparser2'
import type { DocSection, ReadingDocument } from './documents.js'
import { find, htmlToBlocks } from './html-blocks.js'

/**
 * An EPUB read as text: each document in its reading order (the spine) is a
 * section, named by the book's own contents (EPUB 3 nav or EPUB 2 NCX), else
 * by its first heading. Documents with no words (a cover picture, a blank
 * page) are left out.
 */

/** Largest unpacked file read from the book, and the most in all: a guard against zip bombs. */
const MAX_FILE = 64 * 1024 * 1024
const MAX_TOTAL = 512 * 1024 * 1024

interface Node {
  type: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: Node[]
}

export function readEpub(bytes: Uint8Array, title: string): ReadingDocument {
  let total = 0
  const files = unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize
      if (file.originalSize > MAX_FILE || total > MAX_TOTAL) throw new Error('This EPUB is too large to read.')
      return true
    },
  })
  const text = (path: string): string | undefined => {
    const file = files[path]
    return file && new TextDecoder().decode(file)
  }

  const container = text('META-INF/container.xml')
  const root = container && all(xml(container), 'rootfile')[0]?.attribs?.['full-path']
  const opfText = root && text(root)
  if (!root || !opfText) throw new Error("This EPUB has no package file, so it can't be read.")
  const opf = xml(opfText)
  const base = directory(root)

  const manifest = new Map<string, { href: string; type: string; properties: string }>()
  for (const item of all(opf, 'item')) {
    const { id, href } = item.attribs ?? {}
    if (id && href) manifest.set(id, { href: resolve(base, href), type: item.attribs?.['media-type'] ?? '', properties: item.attribs?.properties ?? '' })
  }

  // Titles from the book's contents, by document.
  const titles = new Map<string, string>()
  const nav = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('nav'))
  const navText = nav && text(nav.href)
  if (nav && navText) for (const [href, name] of navTitles(navText, directory(nav.href))) if (!titles.has(href)) titles.set(href, name)
  const spine = all(opf, 'spine')[0]
  const ncx = manifest.get(spine?.attribs?.toc ?? '') ?? [...manifest.values()].find((item) => item.type === 'application/x-dtbncx+xml')
  const ncxText = ncx && text(ncx.href)
  if (ncx && ncxText) for (const [href, name] of ncxTitles(ncxText, directory(ncx.href))) if (!titles.has(href)) titles.set(href, name)

  const sections: DocSection[] = []
  for (const ref of all(spine ?? opf, 'itemref')) {
    if (ref.attribs?.linear === 'no') continue
    const item = manifest.get(ref.attribs?.idref ?? '')
    const page = item && text(item.href)
    if (!item || !page) continue
    const blocks = htmlToBlocks(page, item.type === 'application/xhtml+xml')
    if (blocks.length === 0) continue
    const heading = blocks.find((block) => block.type === 'heading')
    const named = titles.get(item.href) ?? (heading?.type === 'heading' ? heading.text.map((inline) => inline.text).join('').trim() : '')
    sections.push({ title: named || `${title}, part ${sections.length + 1}`, blocks })
  }
  if (sections.length === 0) throw new Error('This EPUB has no text to read.')
  return { sections }
}

function xml(source: string): Node {
  return parseDocument(source, { xmlMode: true, decodeEntities: true }) as unknown as Node
}

/** Every element with this local name (any namespace prefix), in order. */
function all(node: Node, name: string): Node[] {
  const out: Node[] = []
  const walk = (at: Node): void => {
    for (const child of at.children ?? []) {
      if (child.name && localName(child.name) === name) out.push(child)
      walk(child)
    }
  }
  walk(node)
  return out
}

const localName = (name: string): string => name.slice(name.indexOf(':') + 1).toLowerCase()

function words(node: Node): string {
  if (node.type === 'text') return node.data ?? ''
  return (node.children ?? []).map(words).join('')
}

/** EPUB 3: the toc nav's links, as document path → title. */
function navTitles(source: string, base: string): Array<[string, string]> {
  const document = parseDocument(source, { xmlMode: true, decodeEntities: true }) as unknown as Node
  const navs = all(document, 'nav')
  const toc = navs.find((nav) => (nav.attribs?.['epub:type'] ?? '').split(/\s+/).includes('toc')) ?? navs[0] ?? find(document, 'body')
  if (!toc) return []
  return all(toc, 'a').flatMap((link) => {
    const href = link.attribs?.href
    const name = words(link).replace(/\s+/g, ' ').trim()
    return href && name ? [[resolve(base, href), name] as [string, string]] : []
  })
}

/** EPUB 2: the NCX navPoints, as document path → title. */
function ncxTitles(source: string, base: string): Array<[string, string]> {
  return all(xml(source), 'navpoint').flatMap((point) => {
    const label = (point.children ?? []).find((child) => child.name && localName(child.name) === 'navlabel')
    const content = (point.children ?? []).find((child) => child.name && localName(child.name) === 'content')
    const href = content?.attribs?.src
    const name = label ? words(label).replace(/\s+/g, ' ').trim() : ''
    return href && name ? [[resolve(base, href), name] as [string, string]] : []
  })
}

/** The folder part of a path in the book: "OEBPS/content.opf" → "OEBPS/". */
function directory(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1)
}

/** A link inside the book, from the folder it is written in, without its #part. */
function resolve(base: string, href: string): string {
  const path = safeDecode(href.split('#')[0]!.split('?')[0]!)
  const parts: string[] = []
  for (const part of (path.startsWith('/') ? path.slice(1) : base + path).split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}
