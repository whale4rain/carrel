import { unzipSync } from 'fflate'
import { parseDocument } from 'htmlparser2'
import mammoth from 'mammoth'
import type { DocBlock, DocInline, DocSection, ReadingDocument } from './documents.js'
import { htmlToBlocks, tidy } from './html-blocks.js'
import { safeHref } from './safe-href.js'

/**
 * Word and PowerPoint files read as text. A Word file (.docx) becomes HTML
 * through mammoth, then the same blocks as an EPUB chapter, cut into sections
 * at its main headings. A PowerPoint file (.pptx) is one section per slide:
 * its title, its text and tables, and its speaker notes. Layout, pictures and
 * animations are left out.
 */

/** Largest unpacked file read from an Office file, and the most in all: a guard against zip bombs. */
const MAX_FILE = 64 * 1024 * 1024
const MAX_TOTAL = 512 * 1024 * 1024

export async function readWord(bytes: Uint8Array, title: string, sectionsOf: (blocks: DocBlock[], title: string) => DocSection[]): Promise<ReadingDocument> {
  const { value } = await mammoth.convertToHtml(
    { buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) },
    {
      // Pictures keep only their description, and nothing outside the file is read.
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
      externalFileAccess: false,
    },
  )
  const blocks = htmlToBlocks(`<body>${value}</body>`)
  if (blocks.length === 0) throw new Error('This Word file has no text to read.')
  return { sections: sectionsOf(blocks, title) }
}

interface Node {
  type: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: Node[]
}

export function readPowerPoint(bytes: Uint8Array): ReadingDocument {
  const files = unzip(bytes)
  const text = (path: string): string | undefined => {
    const file = files[path]
    return file && new TextDecoder().decode(file)
  }
  const presentation = text('ppt/presentation.xml')
  if (!presentation) throw new Error("This PowerPoint file has no slides, so it can't be read.")
  const links = relationships(text('ppt/_rels/presentation.xml.rels'), 'ppt/')
  const list = find(xml(presentation), 'sldIdLst')
  const slides = (list ? children(list, 'sldId') : [])
    .map((slide) => links.get(slide.attribs?.['r:id'] ?? '')?.target)
    .filter((path): path is string => path !== undefined)

  const sections = slides.map((path, i): DocSection => {
    const source = text(path)
    const slideLinks = relationships(text(relsOf(path)), directory(path))
    const blocks: DocBlock[] = []
    let named = ''
    const tree = source ? find(xml(source), 'spTree') : undefined
    for (const shape of tree ? shapes(tree) : []) {
      if (shape.kind === 'table') {
        blocks.push(shape.block)
        continue
      }
      const paragraphs = shape.paragraphs.map((paragraph) => runs(paragraph, slideLinks)).filter((paragraph) => paragraph.length > 0)
      if (paragraphs.length === 0) continue
      if (shape.role === 'title' && !named) {
        named = paragraphs.map((paragraph) => paragraph.map((inline) => inline.text).join('')).join(' ')
        blocks.unshift({ type: 'heading', level: 2, text: tidy(paragraphs.flatMap((paragraph, at) => (at > 0 ? [{ text: ' ' }, ...paragraph] : paragraph))) })
      } else if (shape.role === 'body') blocks.push({ type: 'list', ordered: false, items: paragraphs.map((paragraph) => [{ type: 'paragraph', text: paragraph }]) })
      else blocks.push(...paragraphs.map((paragraph): DocBlock => ({ type: 'paragraph', text: paragraph })))
    }
    // Speaker notes, after the slide's own words.
    const notesPath = [...slideLinks.values()].find((link) => link.type.endsWith('/notesSlide'))?.target
    const notesSource = notesPath && text(notesPath)
    const notesTree = notesSource ? find(xml(notesSource), 'spTree') : undefined
    const notes = (notesTree ? shapes(notesTree) : [])
      .flatMap((shape) => (shape.kind === 'text' && shape.role === 'body' ? shape.paragraphs.map((paragraph) => runs(paragraph, new Map())) : []))
      .filter((paragraph) => paragraph.length > 0)
    if (notes.length > 0) blocks.push({ type: 'quote', blocks: [{ type: 'paragraph', text: [{ text: 'Speaker notes', italic: true }] }, ...notes.map((paragraph): DocBlock => ({ type: 'paragraph', text: paragraph }))] })
    if (blocks.length === 0) blocks.push({ type: 'paragraph', text: [{ text: 'This slide has no text.', italic: true }] })
    return { title: named.trim() || `Slide ${i + 1}`, blocks }
  })
  if (sections.length === 0) throw new Error('This PowerPoint file has no slides.')
  return { sections }
}

type Shape = { kind: 'text'; role: 'title' | 'body' | 'other'; paragraphs: Node[] } | { kind: 'table'; block: DocBlock }

/** A slide's text boxes and tables, in the order they are drawn, through groups. */
function shapes(tree: Node): Shape[] {
  const out: Shape[] = []
  for (const child of tree.children ?? []) {
    const name = local(child.name)
    if (name === 'sp') {
      const body = children(child, 'txBody')[0]
      if (!body) continue
      const placeholder = find(child, 'ph')
      const type = placeholder?.attribs?.type
      const role = !placeholder ? 'other' : type === 'title' || type === 'ctrTitle' ? 'title' : type === undefined || type === 'body' || type === 'subTitle' || type === 'obj' ? 'body' : 'other'
      out.push({ kind: 'text', role, paragraphs: children(body, 'p') })
    } else if (name === 'grpSp') out.push(...shapes(child))
    else if (name === 'graphicFrame') {
      const table = find(child, 'tbl')
      if (!table) continue
      const rows = children(table, 'tr').map((row) => children(row, 'tc').map((cell) => tidy(children(find(cell, 'txBody') ?? cell, 'p').flatMap((paragraph, at) => (at > 0 ? [{ text: ' ' }, ...runs(paragraph, new Map())] : runs(paragraph, new Map()))))))
      if (rows.length > 0) out.push({ kind: 'table', block: { type: 'table', rows } })
    }
  }
  return out
}

/** A paragraph's runs, with bold, italic and web links. */
function runs(paragraph: Node, links: ReadonlyMap<string, { target: string; type: string; external: boolean }>): DocInline[] {
  const out: DocInline[] = []
  for (const child of paragraph.children ?? []) {
    const name = local(child.name)
    if (name === 'br') out.push({ text: ' ' })
    if (name !== 'r' && name !== 'fld') continue
    const properties = children(child, 'rPr')[0]
    const words = children(child, 't').map(textOf).join('')
    const marks: Omit<DocInline, 'text'> = {}
    if (properties?.attribs?.b === '1') marks.bold = true
    if (properties?.attribs?.i === '1') marks.italic = true
    const link = properties && children(properties, 'hlinkClick')[0]?.attribs?.['r:id']
    const href = link ? safeHref(links.get(link)?.external ? links.get(link)?.target : undefined) : undefined
    if (href) marks.href = href
    out.push({ ...marks, text: words.replace(/\s+/g, ' ') })
  }
  return tidy(out)
}

/** A part's relationships: id → where it points (inside the file, or outside it). */
function relationships(source: string | undefined, base: string): Map<string, { target: string; type: string; external: boolean }> {
  const out = new Map<string, { target: string; type: string; external: boolean }>()
  if (!source) return out
  for (const relation of children(find(xml(source), 'Relationships') ?? xml(source), 'Relationship')) {
    const { Id: id, Target: target, Type: type, TargetMode: mode } = relation.attribs ?? {}
    if (!id || !target) continue
    const external = mode === 'External'
    out.set(id, { target: external ? target : resolve(base, target), type: type ?? '', external })
  }
  return out
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0
  return unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize
      if (file.originalSize > MAX_FILE || total > MAX_TOTAL) throw new Error('This file is too large to read.')
      // Pictures and media are never read.
      return !/\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|mp4|m4v|mov|wav|mp3|m4a|wdp)$/i.test(file.name)
    },
  })
}

function xml(source: string): Node {
  return parseDocument(source, { xmlMode: true, decodeEntities: true }) as unknown as Node
}

const local = (name: string | undefined): string => (name ? name.slice(name.indexOf(':') + 1) : '')

/** Direct children with this local name. */
function children(node: Node, name: string): Node[] {
  return (node.children ?? []).filter((child) => local(child.name) === name)
}

/** The first element with this local name, depth first. */
function find(node: Node, name: string): Node | undefined {
  for (const child of node.children ?? []) {
    if (local(child.name) === name) return child
    const found = find(child, name)
    if (found) return found
  }
  return undefined
}

function textOf(node: Node): string {
  if (node.type === 'text') return node.data ?? ''
  return (node.children ?? []).map(textOf).join('')
}

/** "ppt/slides/slide1.xml" → "ppt/slides/_rels/slide1.xml.rels". */
function relsOf(path: string): string {
  return `${directory(path)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`
}

function directory(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1)
}

function resolve(base: string, target: string): string {
  const parts: string[] = []
  for (const part of (target.startsWith('/') ? target.slice(1) : base + target).split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}
