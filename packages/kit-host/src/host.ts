import { isGrade, reviewState, schedule } from './srs.js'
import { KitStore } from './store.js'
import { ProjectKits, unanswered } from './project-kits.js'
import type { KitShelf } from './shelf.js'
import type { KitManifest, KitNeed } from './manifest.js'
import type { Workspace } from '@carrel/core'

/**
 * The host API a kit's pages call (through `window.kit`, over postMessage,
 * then to main). Read wide, write narrow: a kit reads and changes its own
 * store at any time; it reads the rest of the project only where its
 * manifest asks and the person allowed it; it never changes or deletes
 * anything outside its store directly.
 */

/** How the host reads the rest of the project for a kit. */
export interface ProjectReaders {
  notes(folder: string): Promise<Array<{ id: string; title: string; text: string }>>
  sources(folder: string): Promise<Array<{ id: string; kind: string; title: string }>>
  thats(folder: string): Promise<Array<{ id: string; label: string; text?: string; source: string }>>
}

/** What a kit reads from outside its store comes tagged with where it came from. */
export interface ReadResult {
  from: string
  items: unknown[]
}

export class KitHost {
  private readonly kits: ProjectKits
  private readonly stores = new Map<string, KitStore>()
  /** Calls into one kit's store run one at a time. */
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly workspace: Workspace,
    private readonly shelf: KitShelf,
    private readonly readers: ProjectReaders,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.kits = new ProjectKits(workspace)
  }

  /** Runs one host call for a kit in a project: `method` as the bridge names it, with its arguments. */
  async call(folder: string, name: string, method: string, args: readonly unknown[]): Promise<unknown> {
    const manifest = await this.shelf.get(name)
    if (!manifest) throw new Error(`There is no kit called "${name}" on this computer.`)
    const kit = (await this.kits.list(folder)).find((known) => known.name === name)
    if (!kit) throw new Error(`The ${manifest.title} kit isn't in this project.`)
    const key = `${folder}\u0000${name}`
    const run = (this.queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => this.run(folder, manifest, kit, method, args))
    this.queues.set(key, run)
    return run
  }

  private async run(folder: string, manifest: KitManifest, kit: Awaited<ReturnType<ProjectKits['list']>>[number], method: string, args: readonly unknown[]): Promise<unknown> {
    const store = this.store(folder, manifest)
    const [a, b, c] = args
    switch (method) {
      case 'store.info':
        return store.info(text(a, 'collection'))
      case 'store.get':
        return (await store.get(text(a, 'collection'), text(b, 'id'))) ?? null
      case 'store.set':
        await store.set(text(a, 'collection'), text(b, 'id'), c)
        return null
      case 'store.delete':
        await store.delete(text(a, 'collection'), text(b, 'id'))
        return null
      case 'store.restore':
        await store.restore(text(a, 'collection'), text(b, 'id'))
        return null
      case 'store.query':
        return store.query(text(a, 'collection'), queryOptions(b))
      case 'read': {
        const what = text(a, 'what')
        if (!manifest.reads.includes(what)) throw new Error(`This kit's manifest doesn't ask to read "${what}".`)
        if (unanswered(manifest, kit).reads.includes(what)) throw new Error(`You haven't allowed this kit to read "${what}" yet.`)
        return this.read(folder, what)
      }
      default: {
        const need = NEEDS[method]
        if (need) {
          if (!manifest.needs.includes(need)) throw new Error(`This kit's manifest doesn't ask for ${need}.`)
          if (unanswered(manifest, kit).needs.includes(need)) throw new Error(`You haven't allowed this kit to use ${need} yet.`)
          if (method === 'srs.schedule') {
            if (!isGrade(b)) throw new Error('A review ends in again, hard, good or easy.')
            return schedule(reviewState(a), b, this.now())
          }
          throw new Error(`kit.${method} isn't ready yet in this version of Carrel.`)
        }
        throw new Error(`There is no kit.${method}.`)
      }
    }
  }

  private async read(folder: string, what: string): Promise<ReadResult> {
    if (what === 'notes') return { from: 'notes', items: await this.readers.notes(folder) }
    if (what === 'sources') return { from: 'sources', items: await this.readers.sources(folder) }
    if (what === 'thats') return { from: 'thats', items: await this.readers.thats(folder) }
    // Another kit's store, all of it, read only.
    const other = await this.shelf.get(what.slice('kit:'.length))
    const used = other && (await this.kits.list(folder)).some((kit) => kit.name === other.name)
    if (!other || !used) return { from: what, items: [] }
    const store = this.store(folder, other)
    const items: unknown[] = []
    for (const collection of Object.keys(other.store)) for (const doc of await store.query(collection)) items.push({ collection, ...doc })
    return { from: what, items }
  }

  private store(folder: string, manifest: KitManifest): KitStore {
    const key = `${folder}\u0000${manifest.name}\u0000${manifest.version}\u0000${JSON.stringify(manifest.store)}`
    let store = this.stores.get(key)
    if (!store) {
      store = new KitStore(this.workspace, folder, manifest)
      this.stores.set(key, store)
    }
    return store
  }
}

/** Host calls that a manifest must ask for, by the bridge's method name. */
const NEEDS: Record<string, KitNeed> = { 'agent.ask': 'agent.ask', 'srs.schedule': 'srs.schedule', speak: 'speak' }

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`Expected ${what} as text.`)
  return value
}

function queryOptions(value: unknown): { where?: Record<string, unknown>; limit?: number; deleted?: boolean } {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Query options are an object: { where, limit, deleted }.')
  const options = value as Record<string, unknown>
  const out: { where?: Record<string, unknown>; limit?: number; deleted?: boolean } = {}
  if (options.where !== undefined) {
    if (typeof options.where !== 'object' || options.where === null || Array.isArray(options.where)) throw new Error('`where` is an object of field values.')
    out.where = options.where as Record<string, unknown>
  }
  if (typeof options.limit === 'number') out.limit = options.limit
  if (options.deleted === true) out.deleted = true
  return out
}
