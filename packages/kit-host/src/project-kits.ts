import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { FORMAT, isMissing, readJson, writeJson, type Actor, type Workspace } from '@carrel/core'
import type { KitManifest } from './manifest.js'

/**
 * The kits a project uses. Each has a folder in the project, beside its
 * sources and notes, where its store will live:
 *
 * ~/Carrel/<project>/kits/<kit>/
 *   kit.json   which kit, the version added, who added it and when
 */
export interface ProjectKit {
  format: typeof FORMAT
  name: string
  version: number
  addedBy: Actor
  addedAt: string
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

  private dir(folder: string): string {
    return join(this.workspace.roots.content, folder, 'kits')
  }
}

function isProjectKit(value: unknown): value is ProjectKit {
  if (typeof value !== 'object' || value === null) return false
  const kit = value as Partial<ProjectKit>
  return kit.format === FORMAT && typeof kit.name === 'string' && typeof kit.version === 'number' && (kit.addedBy === 'user' || kit.addedBy === 'agent') && typeof kit.addedAt === 'string'
}
