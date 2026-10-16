import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { FORMAT, isMissing, readJson, writeJson, type Actor, type Workspace } from '@carrel/core'
import type { KitManifest } from './manifest.js'

/**
 * The kits a project uses. Each has a folder in the project, beside its
 * sources and notes, where its store will live:
 *
 * ~/Carrel/<project>/kits/<kit>/
 *   kit.json   which kit, the version added, who added it and when, and
 *              what the person allowed it beyond its own store
 *   store/     its store (see store.ts)
 */
export interface ProjectKit {
  format: typeof FORMAT
  name: string
  version: number
  addedBy: Actor
  addedAt: string
  /** What the person allowed, once, for this project. */
  allowed?: KitAsks & { at: string }
}

/** What a kit asks for beyond its own store. */
export interface KitAsks {
  reads: string[]
  net: string[]
  needs: string[]
}

/** What the manifest asks for. */
export function asksOf(manifest: KitManifest): KitAsks {
  return { reads: manifest.reads, net: manifest.net, needs: manifest.needs }
}

/** What the manifest asks for that the person hasn't allowed yet (empty lists when nothing is). */
export function unanswered(manifest: KitManifest, kit: ProjectKit | undefined): KitAsks {
  const allowed = kit?.allowed
  const missing = (asked: string[], given: string[] | undefined): string[] => asked.filter((ask) => !given?.includes(ask))
  return { reads: missing(manifest.reads, allowed?.reads), net: missing(manifest.net, allowed?.net), needs: missing(manifest.needs, allowed?.needs) }
}

export function asksNothing(asks: KitAsks): boolean {
  return asks.reads.length === 0 && asks.net.length === 0 && asks.needs.length === 0
}

/** What each ask means, in words a person approves. */
export function askLines(asks: KitAsks): string[] {
  const reads: Record<string, string> = { notes: 'Read your notes in this project', sources: 'See the titles of your sources', thats: 'Read your that.s and the words they point at' }
  const needs: Record<string, string> = {
    'that.receive': 'Receive that.s you send it',
    'agent.ask': 'Ask the agent questions (each one shows in the thread)',
    'srs.schedule': 'Schedule reviews',
    speak: 'Read words aloud',
  }
  return [
    ...asks.reads.map((read) => reads[read] ?? `Read the store of the ${read.slice('kit:'.length)} kit`),
    ...asks.needs.map((need) => needs[need] ?? need),
    ...asks.net.map((host) => `Fetch from ${host}`),
  ]
}

export class ProjectKits {
  constructor(
    private readonly workspace: Workspace,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(folder: string): Promise<ProjectKit[]> {
    let entries
    try {
      entries = await readdir(this.dir(folder), { withFileTypes: true })
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
    const kits: ProjectKit[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const kit = await readJson(join(this.dir(folder), entry.name, 'kit.json')).catch(() => undefined)
      if (isProjectKit(kit) && kit.name === entry.name) kits.push(kit)
    }
    return kits.sort((a, b) => a.addedAt.localeCompare(b.addedAt))
  }

  /** Adds a kit to the project, once; adding it again returns it as it was. */
  async add(folder: string, manifest: KitManifest, actor: Actor = 'user'): Promise<ProjectKit> {
    const known = (await this.list(folder)).find((kit) => kit.name === manifest.name)
    if (known) return known
    const kit: ProjectKit = { format: FORMAT, name: manifest.name, version: manifest.version, addedBy: actor, addedAt: this.now().toISOString() }
    await writeJson(join(this.dir(folder), manifest.name, 'kit.json'), kit)
    await this.workspace.event(folder, actor, 'kit.added', { name: kit.name, version: kit.version })
    return kit
  }

  /** Records that the person allowed what the kit asks for now. */
  async allow(folder: string, manifest: KitManifest): Promise<ProjectKit> {
    const kit = (await this.list(folder)).find((known) => known.name === manifest.name)
    if (!kit) throw new Error(`The ${manifest.title} kit isn't in this project.`)
    const allowed: ProjectKit = { ...kit, version: manifest.version, allowed: { ...asksOf(manifest), at: this.now().toISOString() } }
    await writeJson(join(this.dir(folder), manifest.name, 'kit.json'), allowed)
    await this.workspace.event(folder, 'user', 'kit.allowed', { name: kit.name, version: manifest.version, ...asksOf(manifest) })
    return allowed
  }

  private dir(folder: string): string {
    return join(this.workspace.roots.content, folder, 'kits')
  }
}

function isProjectKit(value: unknown): value is ProjectKit {
  if (typeof value !== 'object' || value === null) return false
  const kit = value as Partial<ProjectKit>
  return kit.format === FORMAT && typeof kit.name === 'string' && typeof kit.version === 'number' && (kit.addedBy === 'user' || kit.addedBy === 'agent') && typeof kit.addedAt === 'string'
}
