import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isMissing } from './files.js'
import { fromMarkdown, plainText, toMarkdown, type NoteDoc } from './note-markdown.js'
import type { Actor, Workspace } from './workspace.js'

/**
 * The project's notes, as Markdown files anyone can open:
 *
 * ~/Carrel/<project>/notes/<note id>.md
 *
 * A short header between `---` lines keeps the note's id, title and dates;
 * the rest is the note. *that.* chips are links: `[p.42](that:<anchor id>)`.
 */
export interface NoteSummary {
  id: string
  title: string
  createdBy: Actor
  createdAt: string
  updatedAt: string
}

export interface NoteFile extends NoteSummary {
  doc: NoteDoc
}

/** What a note is called before it has any words. */
export const UNTITLED = 'Untitled note'

/** Longest title kept from a note's first line. */
const TITLE = 120

export class Notes {
  constructor(
    private readonly workspace: Workspace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every note in the project, most recently changed first. */
  async list(folder: string): Promise<NoteSummary[]> {
    let names: string[]
    try {
      names = await readdir(this.notesDir(folder))
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const notes: NoteSummary[] = []
    for (const name of names) {
      if (!/^[\w-]+\.md$/.test(name)) continue
      const note = await this.read(folder, name.slice(0, -3)).catch(() => undefined)
      if (note) notes.push(summaryOf(note))
    }
    return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async read(folder: string, id: string): Promise<NoteFile> {
    const text = await readFile(this.noteFile(folder, id), 'utf8').catch((error: unknown) => {
      if (isMissing(error)) throw new Error('That note is not in this project.')
      throw error
    })
    const { header, body } = splitHeader(text)
    const doc = fromMarkdown(body)
    const stamp = this.now().toISOString()
    return {
      id,
      title: titleOf(doc),
      createdBy: header.createdBy === 'agent' ? 'agent' : 'user',
      createdAt: header.created ?? stamp,
      updatedAt: header.updated ?? header.created ?? stamp,
      doc,
    }
  }

  async create(folder: string, doc: NoteDoc = { type: 'doc', content: [] }, actor: Actor = 'user'): Promise<NoteFile> {
    const stamp = this.now().toISOString()
    const note: NoteFile = { id: randomUUID(), title: titleOf(doc), createdBy: actor, createdAt: stamp, updatedAt: stamp, doc }
    await this.write(folder, note)
    await this.workspace.event(folder, actor, 'note.added', { id: note.id })
    return note
  }

  /** Writes a note's new text. Its title follows its first line. */
  async save(folder: string, id: string, doc: NoteDoc, actor: Actor = 'user'): Promise<NoteFile> {
    const before = await this.read(folder, id)
    if (toMarkdown(before.doc) === toMarkdown(doc)) return before
    const note: NoteFile = { ...before, doc, title: titleOf(doc), updatedAt: this.now().toISOString() }
    await this.write(folder, note)
    await this.workspace.event(folder, actor, 'note.edited', { id })
    return note
  }

  private async write(folder: string, note: NoteFile): Promise<void> {
    const header = [
      '---',
      `id: ${note.id}`,
      `title: ${JSON.stringify(note.title)}`,
      `created: ${note.createdAt}`,
      `updated: ${note.updatedAt}`,
      ...(note.createdBy === 'agent' ? ['createdBy: agent'] : []),
      '---',
      '',
    ].join('\n')
    const path = this.noteFile(folder, note.id)
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, header + toMarkdown(note.doc), 'utf8')
    await rename(temporary, path)
  }

  private notesDir(folder: string): string {
    return join(this.workspace.roots.content, folder, 'notes')
  }

  private noteFile(folder: string, id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`"${id}" is not a note id.`)
    return join(this.notesDir(folder), `${id}.md`)
  }
}

export function summaryOf(note: NoteFile): NoteSummary {
  return { id: note.id, title: note.title, createdBy: note.createdBy, createdAt: note.createdAt, updatedAt: note.updatedAt }
}

/** The first line of a note, or "Untitled note". */
export function titleOf(doc: NoteDoc): string {
  const first = plainText(doc)
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return first ? first.slice(0, TITLE) : UNTITLED
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
