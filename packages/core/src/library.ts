import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { DOCUMENT_EXTENSIONS } from './document-files.js'
import { readJson, writeJson, isMissing } from './files.js'
import { FORMAT, type Actor, type Workspace } from './workspace.js'

/**
 * The project's sources (milestone 3). Each is an item in its own folder:
 *
 * ~/Carrel/<project>/items/<item id>/
 *   item.json        kind, title, who added it, and where the source is
 *   <file>.pdf       a stored book or paper, copied in when added
 *   snapshot.png     how a web page looked when last seen live
 *
 * Books and papers are stored files; web pages and videos are linked by URL
 * and never downloaded.
 */

export type ItemKind = 'book' | 'paper' | 'web_page' | 'video'

export type ItemSource =
  | { storage: 'stored'; file: string; size: number }
  | { storage: 'linked'; url: string }

export interface ItemFile {
  format: typeof FORMAT
  id: string
  kind: ItemKind
  title: string
  createdBy: Actor
  createdAt: string
  source: ItemSource
  /** Where a book or paper was last read: a page, and how far down it (0 to 1). */
  readAt?: ReadingPosition
  /** Pages of a book or paper kept to come back to, in page order. */
  bookmarks?: Bookmark[]
}

/** A page kept to come back to, with a few words to know it by. */
export interface Bookmark {
  page: number
  label: string
  /** When it was kept. */
  at: string
}

export interface ReadingPosition {
  page: number
  offset: number
}

/** Files Carrel can store as sources, by extension: PDFs, and files read as text (see documents.ts). */
export const STORED_EXTENSIONS = ['.pdf', ...DOCUMENT_EXTENSIONS]

export class Library {
  constructor(
    private readonly workspace: Workspace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every item in the project, oldest first. */
  async list(folder: string): Promise<ItemFile[]> {
    let entries
    try {
      entries = await readdir(this.itemsDir(folder), { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const items: ItemFile[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const item = await readJson(join(this.itemsDir(folder), entry.name, 'item.json')).catch(() => undefined)
      if (isItemFile(item)) items.push(item)
    }
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async read(folder: string, id: string): Promise<ItemFile> {
    const item = await readJson(this.itemFile(folder, id))
    if (!isItemFile(item)) throw new Error('That item is not in this project.')
    return item
  }

  /** Where a stored item's file is on disk. */
  async filePath(folder: string, id: string): Promise<string> {
    const item = await this.read(folder, id)
    if (item.source.storage !== 'stored') throw new Error('That item is linked, not stored.')
    return join(this.itemDir(folder, id), item.source.file)
  }

  /** Where a web page's last snapshot is kept. */
  snapshotPath(folder: string, id: string): string {
    return join(this.itemDir(folder, id), 'snapshot.png')
  }

  /** Renames an item, as when a web page tells us its real title. */
  async setTitle(folder: string, id: string, title: string, actor: Actor = 'user'): Promise<ItemFile> {
    const trimmed = title.trim().slice(0, 300)
    const item = await this.read(folder, id)
    if (trimmed.length === 0 || trimmed === item.title) return item
    const next = { ...item, title: trimmed }
    await writeJson(this.itemFile(folder, id), next)
    await this.workspace.event(folder, actor, 'item.renamed', { id, title: trimmed })
    return next
  }

  /**
   * Remembers where a book or paper was last read. Like a desk's view, it is
   * kept without an event: it changes with every scroll.
   */
  async setReadAt(folder: string, id: string, at: ReadingPosition): Promise<void> {
    const item = await this.read(folder, id)
    if (item.source.storage !== 'stored') throw new Error('Only books and papers keep a reading position.')
    const page = Math.max(1, Math.round(at.page))
    const offset = Math.min(1, Math.max(0, at.offset))
    if (item.readAt?.page === page && item.readAt.offset === offset) return
    await writeJson(this.itemFile(folder, id), { ...item, readAt: { page, offset } })
  }

  /**
   * Keeps a page of a book or paper to come back to (one bookmark a page; a
   * new label replaces the old), or lets it go with `label` null.
   */
  async setBookmark(folder: string, id: string, page: number, label: string | null, actor: Actor = 'user'): Promise<ItemFile> {
    const item = await this.read(folder, id)
    if (item.source.storage !== 'stored') throw new Error('Only books and papers keep bookmarks.')
    const at = Math.max(1, Math.round(page))
    const others = (item.bookmarks ?? []).filter((bookmark) => bookmark.page !== at)
    const words = label?.replace(/\s+/g, ' ').trim().slice(0, 120)
    if (label === null && others.length === (item.bookmarks ?? []).length) return item
    const bookmarks = label === null ? others : [...others, { page: at, label: words || `Page ${at}`, at: this.now().toISOString() }].sort((a, b) => a.page - b.page)
    const next: ItemFile = { ...item, bookmarks }
    if (bookmarks.length === 0) delete next.bookmarks
    await writeJson(this.itemFile(folder, id), next)
    await this.workspace.event(folder, actor, label === null ? 'item.unbookmarked' : 'item.bookmarked', { id, page: at })
    return next
  }

  /** Copies a PDF into the project as a new item. */
  async addFile(folder: string, path: string, actor: Actor = 'user'): Promise<ItemFile> {
    const extension = extname(path).toLowerCase()
    if (!STORED_EXTENSIONS.includes(extension)) throw new Error(`Carrel can't open ${extension || 'that kind of'} files yet. Try a PDF or a Markdown file.`)
    const info = await stat(path)
    if (!info.isFile()) throw new Error('That is not a file.')
    const id = randomUUID()
    const file = safeFileName(basename(path))
    await mkdir(this.itemDir(folder, id), { recursive: true })
    await copyFile(path, join(this.itemDir(folder, id), file))
    const item: ItemFile = {
      format: FORMAT,
      id,
      kind: 'paper',
      title: titleFromFile(file),
      createdBy: actor,
      createdAt: this.now().toISOString(),
      source: { storage: 'stored', file, size: info.size },
    }
    return this.save(folder, item, actor)
  }

  /** Links a web page or a video by its URL. */
  async addLink(folder: string, link: string, actor: Actor = 'user'): Promise<ItemFile> {
    const url = parseLink(link)
    const item: ItemFile = {
      format: FORMAT,
      id: randomUUID(),
      kind: isVideo(url) ? 'video' : 'web_page',
      title: titleFromUrl(url),
      createdBy: actor,
      createdAt: this.now().toISOString(),
      source: { storage: 'linked', url: url.href },
    }
    return this.save(folder, item, actor)
  }

  private async save(folder: string, item: ItemFile, actor: Actor): Promise<ItemFile> {
    await writeJson(this.itemFile(folder, item.id), item)
    await this.workspace.event(folder, actor, 'item.added', { id: item.id, kind: item.kind, title: item.title })
    return item
  }

  private itemsDir(folder: string): string {
    return join(this.workspace.roots.content, folder, 'items')
  }

  private itemDir(folder: string, id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`"${id}" is not an item id.`)
    return join(this.itemsDir(folder), id)
  }

  private itemFile(folder: string, id: string): string {
    return join(this.itemDir(folder, id), 'item.json')
  }
}

/** A web address Carrel can link: http or https only. */
export function parseLink(link: string): URL {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    throw new Error('That is not a web address.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https links can be added.')
  return url
}

const VIDEO_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'vimeo.com', 'www.vimeo.com']

export function isVideo(url: URL): boolean {
  return VIDEO_HOSTS.includes(url.hostname)
}

/** Until the page tells us its title: the host and the last part of the path. */
export function titleFromUrl(url: URL): string {
  const host = url.hostname.replace(/^www\./, '')
  const last = url.pathname.split('/').filter(Boolean).at(-1)
  return last ? `${host} · ${decodeURIComponent(last).replace(/[-_]+/g, ' ')}` : host
}

function titleFromFile(file: string): string {
  return file.slice(0, file.length - extname(file).length).replace(/[-_]+/g, ' ').trim() || file
}

/** A file name that is safe on Mac and Windows. */
function safeFileName(name: string): string {
  const cleaned = [...name]
    .map((char) => ((char.codePointAt(0) ?? 0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
    .join('')
    .replace(/[. ]+$/, '')
  return cleaned.length > 0 && cleaned !== 'item.json' ? cleaned : `source${extname(name).toLowerCase() || '.pdf'}`
}

function isItemFile(value: unknown): value is ItemFile {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  const source = item.source as Record<string, unknown> | undefined
  return (
    item.format === FORMAT &&
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    ['book', 'paper', 'web_page', 'video'].includes(item.kind as string) &&
    typeof source === 'object' &&
    source !== null &&
    ((source.storage === 'stored' && typeof source.file === 'string') || (source.storage === 'linked' && typeof source.url === 'string'))
  )
}
