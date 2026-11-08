import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMissing, readJson, writeJson } from './files.js'
import { isSelector, positionLabel, type Selector } from './selectors.js'
import { FORMAT, type Actor, type Workspace } from './workspace.js'

/**
 * The project's *that.* anchors: where each one points, and what it showed.
 *
 * ~/Carrel/<project>/anchors/
 *   <anchor id>.json   the item, its selectors, and the snapshot's text
 *   <anchor id>.png    the snapshot's image (a video frame), if it has one
 *   removed/           *that.*s taken away, kept here so nothing is lost
 *
 * The snapshot keeps a chip readable when its source changes or goes away.
 */
export interface AnchorFile {
  format: typeof FORMAT
  id: string
  itemId: string
  selectors: Selector[]
  /** Where it points, for its chip: "p.42", "12:34", or empty for a web page. */
  label: string
  snapshot: { text?: string; image?: string }
  createdBy: Actor
  createdAt: string
}

export interface NewAnchor {
  itemId: string
  selectors: Selector[]
  text?: string
  /** Where it points, when the selectors alone don't say it well: "§3" in a document read as text. */
  label?: string
  /** A PNG of what it pointed at. */
  image?: Uint8Array
}

/** Longest quote a snapshot keeps. */
const SNAPSHOT_TEXT = 2000

export class Anchors {
  constructor(
    private readonly workspace: Workspace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async make(folder: string, anchor: NewAnchor, actor: Actor = 'user'): Promise<AnchorFile> {
    if (anchor.selectors.length === 0 || !anchor.selectors.every(isSelector)) throw new Error('That is not a place in a source.')
    const id = randomUUID()
    const text = anchor.text?.trim().slice(0, SNAPSHOT_TEXT)
    const file: AnchorFile = {
      format: FORMAT,
      id,
      itemId: anchor.itemId,
      selectors: anchor.selectors,
      label: anchor.label ?? positionLabel(anchor.selectors),
      snapshot: { ...(text ? { text } : {}), ...(anchor.image ? { image: `${id}.png` } : {}) },
      createdBy: actor,
      createdAt: this.now().toISOString(),
    }
    await writeJson(this.anchorFile(folder, id), file)
    if (anchor.image) await writeFile(join(this.dir(folder), `${id}.png`), anchor.image)
    await this.workspace.event(folder, actor, 'that.made', { id, item: anchor.itemId })
    return file
  }

  /** Every anchor in the project, oldest first; or only one item's. */
  async list(folder: string, itemId?: string): Promise<AnchorFile[]> {
    let names: string[]
    try {
      names = await readdir(this.dir(folder))
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const anchors: AnchorFile[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const anchor = await readJson(join(this.dir(folder), name)).catch(() => undefined)
      if (isAnchorFile(anchor) && (itemId === undefined || anchor.itemId === itemId)) anchors.push(anchor)
    }
    return anchors.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async read(folder: string, id: string): Promise<AnchorFile> {
    const anchor = await readJson(this.anchorFile(folder, id))
    if (!isAnchorFile(anchor)) throw new Error('That that. is not in this project.')
    return anchor
  }

  /**
   * Takes a *that.* away: it moves to anchors/removed/, so its source no
   * longer shows it and lists leave it out. Refuses one that something
   * still cites, so no chip loses its place.
   */
  async remove(folder: string, id: string, actor: Actor = 'user'): Promise<void> {
    const anchor = await this.read(folder, id)
    if ((await this.cited(folder)).has(id)) throw new Error('A note, a question or a kit still uses that that.')
    const removed = join(this.dir(folder), 'removed')
    await mkdir(removed, { recursive: true })
    if (anchor.snapshot.image) await rename(join(this.dir(folder), anchor.snapshot.image), join(removed, anchor.snapshot.image)).catch(() => undefined)
    await rename(this.anchorFile(folder, id), join(removed, `${id}.json`))
    await this.workspace.event(folder, actor, 'that.removed', { id, item: anchor.itemId })
  }

  /**
   * Takes away the *that.*s nothing uses that are older than `days`: made,
   * then never cited in a note, a question, a proposal or a kit. Returns
   * their ids.
   */
  async tidy(folder: string, days = UNUSED_DAYS): Promise<string[]> {
    const before = this.now().getTime() - days * DAY
    const old = (await this.list(folder)).filter((anchor) => Date.parse(anchor.createdAt) < before)
    if (old.length === 0) return []
    const cited = await this.cited(folder)
    const unused = old.filter((anchor) => !cited.has(anchor.id))
    for (const anchor of unused) await this.remove(folder, anchor.id, 'user').catch(() => undefined)
    return unused.map((anchor) => anchor.id)
  }

  /** Ids of the *that.*s that notes, threads, proposals and kit stores mention. */
  async cited(folder: string): Promise<Set<string>> {
    const ids = new Set((await this.list(folder)).map((anchor) => anchor.id))
    const found = new Set<string>()
    if (ids.size === 0) return found
    const root = join(this.workspace.roots.content, folder)
    for (const place of CITING) {
      for (const file of await textFiles(join(root, place))) {
        const text = await readFile(file, 'utf8').catch(() => '')
        for (const id of ids) if (!found.has(id) && text.includes(id)) found.add(id)
      }
    }
    return found
  }

  /** Where an anchor's snapshot image is, if it has one. */
  async imagePath(folder: string, id: string): Promise<string | undefined> {
    const anchor = await this.read(folder, id)
    return anchor.snapshot.image ? join(this.dir(folder), anchor.snapshot.image) : undefined
  }

  private dir(folder: string): string {
    return join(this.workspace.roots.content, folder, 'anchors')
  }

  private anchorFile(folder: string, id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error(`"${id}" is not an anchor id.`)
    return join(this.dir(folder), `${id}.json`)
  }
}

/** An unused *that.* is taken away after this many days. */
export const UNUSED_DAYS = 7
const DAY = 24 * 60 * 60 * 1000
/** The project's folders that can cite a *that.*. */
const CITING = ['notes', 'threads', 'proposals', 'kits']

/** Every Markdown and JSON file under a folder. */
async function textFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await textFiles(path)))
    else if (/\.(md|json|jsonl)$/.test(entry.name)) files.push(path)
  }
  return files
}

function isAnchorFile(value: unknown): value is AnchorFile {
  if (typeof value !== 'object' || value === null) return false
  const anchor = value as Partial<AnchorFile>
  return (
    anchor.format === FORMAT &&
    typeof anchor.id === 'string' &&
    typeof anchor.itemId === 'string' &&
    Array.isArray(anchor.selectors) &&
    anchor.selectors.every(isSelector) &&
    typeof anchor.label === 'string' &&
    typeof anchor.snapshot === 'object'
  )
}
