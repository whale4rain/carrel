import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isMissing } from './files.js'
import { citedThats, fromMarkdown, plainText, tagsOf, toMarkdown, type NoteDoc } from './note-markdown.js'
import type { Actor, Workspace } from './workspace.js'

/**
 * The project's notes, as Markdown files anyone can open, filed in folders
 * and named by their titles, the way Obsidian keeps a vault:
 *
 * ~/Carrel/<project>/notes/Microeconomics/Elasticity.md
 *
 * A short header between `---` lines keeps the note's id, title and dates,
 * plus any other properties the file came with; the rest is the note.
 * *that.* chips are links: `[p.42](that:<anchor id>)`. The id stays with the
 * note when it is renamed or moved, so desks and links keep finding it.
 */
export interface NoteSummary {
  id: string
  title: string
  /** The folder it is filed in, under notes/ ("" for none; "a/b" when nested). */
  folder: string
  createdBy: Actor
  createdAt: string
  updatedAt: string
  /** Its #tags, lower-cased. */
  tags: string[]
  /** The *that.*s it cites, by anchor id. */
  cites: string[]
}

export interface NoteFile extends NoteSummary {
  doc: NoteDoc
}

/** What a note is called before it has any words. */
export const UNTITLED = 'Untitled note'

/** Longest title kept from a note's first line. */
const TITLE = 120

/** Longest file name made from a title, before ".md". */
const FILE_NAME = 100

/** Header keys Carrel writes itself; any others are kept as they were. */
const OWN_KEYS = new Set(['id', 'title', 'created', 'updated', 'createdBy'])

/** Names of notes saved before they were named by title. */
const ID_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What a note file holds, as read. */
interface Parsed {
  note: NoteFile
  /** Header lines Carrel doesn't own (other apps' properties), as written. */
  extra: string[]
}

export class Notes {
  /** Per project: where each note's file is, by id, relative to notes/ ("Micro/Elasticity.md"). */
  private readonly paths = new Map<string, Map<string, string>>()

  constructor(
    private readonly workspace: Workspace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every note in the project, most recently changed first. */
  async list(folder: string): Promise<NoteSummary[]> {
    const notes = (await this.scan(folder)).map(({ note }) => summaryOf(note))
    return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** Every folder under notes/, empty ones too, sorted ("a", "a/b", "c"). */
  async folders(folder: string): Promise<string[]> {
    const found: string[] = []
    const walk = async (relative: string): Promise<void> => {
      for (const entry of await entries(join(this.notesDir(folder), relative))) {
        if (!entry.isDirectory() || hidden(entry.name)) continue
        const path = relative ? `${relative}/${entry.name}` : entry.name
        found.push(path)
        await walk(path)
      }
    }
    await walk('')
    return found.sort((a, b) => a.localeCompare(b))
  }

  async read(folder: string, id: string): Promise<NoteFile> {
    return (await this.parsed(folder, id)).note
  }

  async create(folder: string, doc: NoteDoc = { type: 'doc', content: [] }, actor: Actor = 'user', at = ''): Promise<NoteFile> {
    const place = cleanFolder(at)
    const stamp = this.now().toISOString()
    const title = titleOf(doc)
    const note: NoteFile = { id: randomUUID(), title, folder: place, tags: tagsOf(doc), cites: citedThats(doc), createdBy: actor, createdAt: stamp, updatedAt: stamp, doc }
    const relative = await this.freeName(folder, place, fileName(title))
    await this.write(folder, relative, note, [])
    await this.workspace.event(folder, actor, 'note.added', { id: note.id, path: relative })
    return note
  }

  /** Writes a note's new text. Its title follows its first line, and its file follows its title. */
  async save(folder: string, id: string, doc: NoteDoc, actor: Actor = 'user'): Promise<NoteFile> {
    const { note: before, extra } = await this.parsed(folder, id)
    if (toMarkdown(before.doc) === toMarkdown(doc)) return before
    const note: NoteFile = { ...before, doc, title: titleOf(doc), tags: tagsOf(doc), cites: citedThats(doc), updatedAt: this.now().toISOString() }
    let relative = this.index(folder).get(id)!
    if (note.title !== before.title) relative = await this.moveFile(folder, id, before.folder, fileName(note.title))
    await this.write(folder, relative, note, extra)
    await this.workspace.event(folder, actor, 'note.edited', { id })
    return note
  }

  /** Files a note in another folder ("" for none), keeping its name if it is free there. */
  async move(folder: string, id: string, to: string, actor: Actor = 'user'): Promise<NoteFile> {
    const place = cleanFolder(to)
    const { note } = await this.parsed(folder, id)
    if (note.folder === place) return note
    const from = this.index(folder).get(id)!
    const relative = await this.moveFile(folder, id, place, basename(from).slice(0, -3))
    await this.workspace.event(folder, actor, 'note.moved', { id, from, to: relative })
    return { ...note, folder: place }
  }

  /** Makes a folder under notes/ (and any folders above it). */
  async createFolder(folder: string, path: string, actor: Actor = 'user'): Promise<string> {
    const place = cleanFolder(path)
    if (place === '') throw new Error('Give the folder a name.')
    await mkdir(join(this.notesDir(folder), place), { recursive: true })
    await this.workspace.event(folder, actor, 'folder.added', { path: place })
    return place
  }

  /** Renames or moves a folder, with every note in it. */
  async renameFolder(folder: string, from: string, to: string, actor: Actor = 'user'): Promise<string> {
    const source = cleanFolder(from)
    const target = cleanFolder(to)
    if (source === '' || target === '') throw new Error('Give the folder a name.')
    if (source === target) return target
    if (target.startsWith(`${source}/`)) throw new Error('A folder cannot go inside itself.')
    // A new name that only changes case is the same folder on Mac and Windows.
    if (source.toLowerCase() !== target.toLowerCase() && (await exists(join(this.notesDir(folder), target)))) throw new Error(`There is already a folder called "${target}".`)
    await mkdir(dirname(join(this.notesDir(folder), target)), { recursive: true })
    await rename(join(this.notesDir(folder), source), join(this.notesDir(folder), target))
    this.paths.delete(folder)
    await this.workspace.event(folder, actor, 'folder.renamed', { from: source, to: target })
    return target
  }

  /** A note's file read again, finding it anew if it was moved outside Carrel. */
  private async parsed(folder: string, id: string): Promise<Parsed> {
    if (!/^[\w-]+$/.test(id)) throw new Error(`"${id}" is not a note id.`)
    for (const fresh of [false, true]) {
      if (fresh || !this.index(folder).has(id)) await this.scan(folder)
      const relative = this.index(folder).get(id)
      if (relative === undefined) break
      try {
        return this.parse(relative, await readFile(join(this.notesDir(folder), relative), 'utf8'))
      } catch (error) {
        if (!isMissing(error)) throw error
      }
    }
    throw new Error('That note is not in this project.')
  }

  /**
   * Reads every note file under notes/ and remembers where each one is.
   * A Markdown file put there by hand, or by another app, gets an id in its
   * header; a note still named by its id takes its title as its name.
   */
  private async scan(folder: string): Promise<Parsed[]> {
    const index = new Map<string, string>()
    const found: Parsed[] = []
    const walk = async (relative: string): Promise<void> => {
      for (const entry of await entries(join(this.notesDir(folder), relative))) {
        if (hidden(entry.name)) continue
        const path = relative ? `${relative}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(path)
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          const read = await this.adopt(folder, path, index).catch(() => undefined)
          if (!read) continue
          index.set(read.note.id, read.path)
          found.push(read.parsed)
        }
      }
    }
    await walk('')
    this.paths.set(folder, index)
    return found
  }

  /** One file found by `scan`, given an id or its title as a name if it needs one. */
  private async adopt(folder: string, path: string, index: ReadonlyMap<string, string>): Promise<{ note: NoteFile; path: string; parsed: Parsed }> {
    const text = await readFile(join(this.notesDir(folder), path), 'utf8')
    let parsed = this.parse(path, text)
    const { header } = splitHeader(text)
    // A file with no id, or a copy of another note's, becomes a note of its own.
    if (!header.id || !/^[\w-]+$/.test(header.id) || index.has(header.id)) {
      parsed = { ...parsed, note: { ...parsed.note, id: randomUUID() } }
      await this.write(folder, path, parsed.note, parsed.extra)
    }
    let relative = path
    const name = basename(path).slice(0, -3)
    if (ID_NAME.test(name) && name === parsed.note.id) {
      relative = await this.freeName(folder, parsed.note.folder, fileName(parsed.note.title))
      await rename(join(this.notesDir(folder), path), join(this.notesDir(folder), relative))
    }
    return { note: parsed.note, path: relative, parsed }
  }

  private parse(relative: string, text: string): Parsed {
    const { header, body } = splitHeader(text)
    const doc = fromMarkdown(body)
    const stamp = this.now().toISOString()
    const place = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : ''
    return {
      note: {
        id: header.id ?? '',
        title: titleOf(doc),
        folder: place,
        tags: tagsOf(doc),
        cites: citedThats(doc),
        createdBy: header.createdBy === 'agent' ? 'agent' : 'user',
        createdAt: header.created ?? stamp,
        updatedAt: header.updated ?? header.created ?? stamp,
        doc,
      },
      extra: headerEntries(text).filter((entry) => entry.key === undefined || !OWN_KEYS.has(entry.key)).map((entry) => entry.text),
    }
  }

  /** Moves a note's file to `place`, named `name` (or "name 2" if that is taken); returns where it went. */
  private async moveFile(folder: string, id: string, place: string, name: string): Promise<string> {
    const from = this.index(folder).get(id)!
    const relative = await this.freeName(folder, place, name, from)
    if (relative !== from) {
      await mkdir(dirname(join(this.notesDir(folder), relative)), { recursive: true })
      await rename(join(this.notesDir(folder), from), join(this.notesDir(folder), relative))
      this.index(folder).set(id, relative)
    }
    return relative
  }

  /**
   * A file name in `place` no other note has: "Elasticity.md", then
   * "Elasticity 2.md". Names differing only in case count as taken, as they
   * do on Mac and Windows. `mine` is the note's own file, which is free to it.
   */
  private async freeName(folder: string, place: string, name: string, mine?: string): Promise<string> {
    const taken = new Set((await entries(join(this.notesDir(folder), place))).map((entry) => entry.name.toLowerCase()))
    const prefix = place ? `${place}/` : ''
    for (let n = 1; ; n++) {
      const candidate = `${name}${n === 1 ? '' : ` ${n}`}.md`
      if (`${prefix}${candidate}`.toLowerCase() === mine?.toLowerCase()) return mine!
      if (!taken.has(candidate.toLowerCase())) return `${prefix}${candidate}`
    }
  }

  private async write(folder: string, relative: string, note: NoteFile, extra: readonly string[]): Promise<void> {
    const header = [
      '---',
      `id: ${note.id}`,
      `title: ${JSON.stringify(note.title)}`,
      `created: ${note.createdAt}`,
      `updated: ${note.updatedAt}`,
      ...(note.createdBy === 'agent' ? ['createdBy: agent'] : []),
      ...extra,
      '---',
      '',
    ].join('\n')
    const path = join(this.notesDir(folder), relative)
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, header + toMarkdown(note.doc), 'utf8')
    await rename(temporary, path)
    this.index(folder).set(note.id, relative)
  }

  private index(folder: string): Map<string, string> {
    let index = this.paths.get(folder)
    if (!index) this.paths.set(folder, (index = new Map()))
    return index
  }

  private notesDir(folder: string): string {
    return join(this.workspace.roots.content, folder, 'notes')
  }
}

export function summaryOf(note: NoteFile): NoteSummary {
  return { id: note.id, title: note.title, folder: note.folder, createdBy: note.createdBy, createdAt: note.createdAt, updatedAt: note.updatedAt, tags: note.tags, cites: note.cites }
}

/** The first line of a note, or "Untitled note". */
export function titleOf(doc: NoteDoc): string {
  const first = plainText(doc)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return first ? first.slice(0, TITLE) : UNTITLED
}

/**
 * A title as a file name that works on Mac and Windows and in Obsidian:
 * without / \ : * ? " < > | # ^ [ ], not starting with a dot, not ending
 * with a dot or space, and not a name Windows keeps for itself.
 */
export function fileName(title: string): string {
  let name = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, FILE_NAME)
    .replace(/[\s.]+$/, '')
  if (name === '') name = UNTITLED
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name = `${name} note`
  return name
}

/** A folder path under notes/, checked: "Micro/Demand", never "..", "/x" or ".hidden". */
export function cleanFolder(path: string): string {
  const parts = path.split(/[\\/]/).map((part) => part.trim()).filter((part) => part.length > 0)
  for (const part of parts) {
    if (part !== fileName(part) || hidden(part)) throw new Error(`"${part}" can't be a folder name.`)
  }
  return parts.join('/')
}

/** The `---` header's keys and the Markdown after it. */
export function splitHeader(text: string): { header: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return { header: {}, body: text }
  const header: Record<string, string> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const pair = /^(\w+):\s*(.*)$/.exec(line)
    if (!pair) continue
    let value = pair[2]!.trim()
    if (value.startsWith('"')) {
      try {
        value = String(JSON.parse(value))
      } catch {
        value = value.slice(1, -1)
      }
    }
    header[pair[1]!] = value
  }
  return { header, body: text.slice(match[0].length) }
}

/**
 * The header's lines, grouped by key: a key's line and the indented or "- "
 * lines under it (a YAML list), so properties from other apps survive a save.
 */
function headerEntries(text: string): Array<{ key?: string; text: string }> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return []
  const found: Array<{ key?: string; text: string }> = []
  for (const line of match[1]!.split(/\r?\n/)) {
    const key = /^([\w-]+):/.exec(line)?.[1]
    const last = found.at(-1)
    if (key === undefined && last && /^(\s|-)/.test(line)) last.text += `\n${line}`
    else if (line.trim().length > 0) found.push(key === undefined ? { text: line } : { key, text: line })
  }
  return found
}

function basename(relative: string): string {
  return relative.slice(relative.lastIndexOf('/') + 1)
}

/** Folders and files other apps keep for themselves: .obsidian, .trash, .DS_Store. */
function hidden(name: string): boolean {
  return name.startsWith('.')
}

async function entries(path: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    (error: unknown) => {
      if (isMissing(error)) return false
      throw error
    },
  )
}
