import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isMissing } from '@carrel/core'
import { isKitPath, parseManifest, type KitManifest } from './manifest.js'

/**
 * The kits installed on this computer: one folder each, holding `kit.json`
 * and its pages. First-party kits come with the app; kits a person builds
 * will live in ~/.carrel/kits. Manifests are read again on every call, so an
 * edited kit shows up without a restart.
 */
export class KitShelf {
  constructor(private readonly roots: readonly string[]) {}

  /** Every kit that reads, by name (an earlier root wins), and what is wrong with the rest. */
  async list(): Promise<{ kits: KitManifest[]; problems: Array<{ folder: string; message: string }> }> {
    const kits = new Map<string, KitManifest>()
    const problems: Array<{ folder: string; message: string }> = []
    for (const root of this.roots) {
      let entries
      try {
        entries = await readdir(root, { withFileTypes: true })
      } catch (error) {
        if (isMissing(error)) continue
        throw error
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const folder = join(root, entry.name)
        try {
          const manifest = parseManifest(JSON.parse(await readFile(join(folder, 'kit.json'), 'utf8')))
          if (manifest.name !== entry.name) throw new Error(`This kit's manifest names it "${manifest.name}", but its folder is "${entry.name}".`)
          if (!kits.has(manifest.name)) kits.set(manifest.name, manifest)
        } catch (error) {
          if (isMissing(error)) continue
          problems.push({ folder, message: error instanceof Error ? error.message : String(error) })
        }
      }
    }
    return { kits: [...kits.values()], problems }
  }

  async get(name: string): Promise<KitManifest | undefined> {
    return (await this.list()).kits.find((kit) => kit.name === name)
  }

  /** Where a file of a kit is on disk, or undefined if the path leaves the kit. */
  async file(name: string, path: string): Promise<string | undefined> {
    if (!isKitPath(path)) return undefined
    for (const root of this.roots) {
      try {
        const manifest = parseManifest(JSON.parse(await readFile(join(root, name, 'kit.json'), 'utf8')))
        if (manifest.name === name) return join(root, name, ...path.split('/'))
      } catch {
        // Not in this root.
      }
    }
    return undefined
  }
}
