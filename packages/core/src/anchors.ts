import { randomUUID } from 'node:crypto'
import { readdir, writeFile } from 'node:fs/promises'
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
