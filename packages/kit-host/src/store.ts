import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, writeJson, type Workspace } from '@carrel/core'
import type { KitManifest } from './manifest.js'

/**
 * A kit's own store in a project: one file per collection the manifest
 * declares, kept with the project so it travels with it.
 *
 * ~/Carrel/<project>/kits/<kit>/store/<collection>.json
 * ~/Carrel/<project>/kits/<kit>/store/snapshots/<collection>.v<n>.<time>.json
 *
 * A kit may read and change its store at any time. Deleting only marks a
 * document deleted, so it can be brought back. When the manifest moves a
 * collection to a new schema version, the old file is copied to snapshots
 * first; the kit's own pages move the documents forward.
 */

export interface StoreDoc {
  id: string
  value: unknown
  createdAt: string
  updatedAt: string
  /** Set when deleted; the document comes back with `restore`. */
  deletedAt?: string
}

interface CollectionFile {
  schemaVersion: number
  /** The schema version the documents were written under, before a move. */
  movedFrom?: number
  docs: Record<string, StoreDoc>
}

/** The most documents a collection keeps, and the biggest one, as JSON. */
export const MAX_DOCS = 20_000
export const MAX_DOC_BYTES = 256 * 1024

const ID = /^[A-Za-z0-9_.:-]{1,120}$/

export class KitStore {
  private readonly cache = new Map<string, Promise<CollectionFile>>()

  constructor(
    private readonly workspace: Workspace,
    private readonly folder: string,
    private readonly kit: KitManifest,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The collection's schema version, and the one its documents came from if the kit has just moved it. */
  async info(collection: string): Promise<{ schemaVersion: number; movedFrom?: number; count: number }> {
    const file = await this.open(collection)
    return { schemaVersion: file.schemaVersion, ...(file.movedFrom !== undefined ? { movedFrom: file.movedFrom } : {}), count: live(file).length }
  }

  async get(collection: string, id: string): Promise<unknown> {
    const doc = (await this.open(collection)).docs[checkId(id)]
    return doc && !doc.deletedAt ? doc.value : undefined
  }

  async set(collection: string, id: string, value: unknown): Promise<void> {
    checkId(id)
    const json = JSON.stringify(value)
    if (json === undefined) throw new Error('Only JSON can be kept in a kit store.')
    if (Buffer.byteLength(json) > MAX_DOC_BYTES) throw new Error(`A document in a kit store can be at most ${MAX_DOC_BYTES / 1024} KB.`)
    const file = await this.open(collection)
    const at = this.now().toISOString()
    const known = file.docs[id]
    if (!known && Object.keys(file.docs).length >= MAX_DOCS) throw new Error(`The "${collection}" collection is full (${MAX_DOCS} documents).`)
    file.docs[id] = { id, value: JSON.parse(json) as unknown, createdAt: known?.createdAt ?? at, updatedAt: at }
    delete file.movedFrom
    await this.save(collection, file, known ? 'changed' : 'added', id)
  }

  /** Marks a document deleted; `restore` brings it back. */
  async delete(collection: string, id: string): Promise<void> {
    const file = await this.open(collection)
    const doc = file.docs[checkId(id)]
    if (!doc || doc.deletedAt) return
    doc.deletedAt = this.now().toISOString()
    await this.save(collection, file, 'deleted', id)
  }

  async restore(collection: string, id: string): Promise<void> {
    const file = await this.open(collection)
    const doc = file.docs[checkId(id)]
    if (!doc?.deletedAt) return
    delete doc.deletedAt
    doc.updatedAt = this.now().toISOString()
    await this.save(collection, file, 'restored', id)
  }

  /**
   * The collection's documents, oldest first: those whose top-level fields
   * equal every field in `where`, at most `limit` of them. Deleted ones only
   * when asked for.
   */
  async query(collection: string, options: { where?: Record<string, unknown>; limit?: number; deleted?: boolean } = {}): Promise<Array<{ id: string; value: unknown; updatedAt: string }>> {
    const file = await this.open(collection)
    const where = Object.entries(options.where ?? {})
    const limit = Math.max(0, Math.min(MAX_DOCS, options.limit ?? MAX_DOCS))
    return Object.values(file.docs)
      .filter((doc) => (options.deleted ? doc.deletedAt !== undefined : doc.deletedAt === undefined))
      .filter((doc) => where.every(([field, wanted]) => isRecord(doc.value) && JSON.stringify(doc.value[field]) === JSON.stringify(wanted)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((doc) => ({ id: doc.id, value: doc.value, updatedAt: doc.updatedAt }))
  }

  private open(collection: string): Promise<CollectionFile> {
    const spec = this.kit.store[collection]
    if (!spec) return Promise.reject(new Error(`This kit has no "${collection}" collection in its manifest.`))
    let opened = this.cache.get(collection)
    if (!opened) {
      opened = this.load(collection, spec.schemaVersion)
      opened.catch(() => this.cache.delete(collection))
      this.cache.set(collection, opened)
    }
    return opened
  }

  private async load(collection: string, schemaVersion: number): Promise<CollectionFile> {
    const path = this.path(collection)
    const read = await readJson(path)
    if (read === undefined) return { schemaVersion, docs: {} }
    if (!isCollectionFile(read)) throw new Error(`The kit's "${collection}" collection can't be read.`)
    if (read.schemaVersion !== schemaVersion) {
      // A new schema: keep the old file first.
      const stamp = this.now().toISOString().replace(/[:.]/g, '-')
      await mkdir(join(this.dir(), 'snapshots'), { recursive: true })
      await copyFile(path, join(this.dir(), 'snapshots', `${collection}.v${read.schemaVersion}.${stamp}.json`))
      const moved: CollectionFile = { schemaVersion, movedFrom: read.schemaVersion, docs: read.docs }
      await writeJson(path, moved)
      await this.workspace.event(this.folder, 'user', 'kit.store.moved', { kit: this.kit.name, collection, from: read.schemaVersion, to: schemaVersion })
      return moved
    }
    return read
  }

  private async save(collection: string, file: CollectionFile, change: string, id: string): Promise<void> {
    await writeJson(this.path(collection), file)
    await this.workspace.event(this.folder, 'user', `kit.store.${change}`, { kit: this.kit.name, collection, id })
  }

  private dir(): string {
    return join(this.workspace.roots.content, this.folder, 'kits', this.kit.name, 'store')
  }

  private path(collection: string): string {
    return join(this.dir(), `${collection}.json`)
  }
}

function live(file: CollectionFile): StoreDoc[] {
  return Object.values(file.docs).filter((doc) => !doc.deletedAt)
}

function checkId(id: string): string {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('A document id is 1 to 120 letters, digits, or _ . : -')
  return id
}

function isCollectionFile(value: unknown): value is CollectionFile {
  return isRecord(value) && typeof value.schemaVersion === 'number' && isRecord(value.docs)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
