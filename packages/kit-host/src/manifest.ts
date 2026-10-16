/**
 * A learning kit's manifest, `kit.json` in the kit's folder. It says what the
 * kit shows (its sheets), what it keeps (its store), and what it asks for
 * beyond its own store: what it reads, where it may fetch from, and which
 * host abilities it needs. The person approves it once, when the kit is
 * first added to a project.
 */

export interface KitSheet {
  /** Short name, unique in the kit: "deck". */
  id: string
  /** What the sheet's label row says: "Vocabulary". */
  title: string
  /** The page, relative to the kit's folder: "sheets/deck.html". */
  file: string
  /** How big a new sheet is at 100%, in desk units. */
  size: { w: number; h: number }
}

export interface KitManifest {
  /** Lower-case name, also its folder: "language". */
  name: string
  title: string
  /** One plain sentence on what it is for. */
  description: string
  /** Goes up with every change a person keeps. */
  version: number
  sheets: KitSheet[]
  /** The collections in its store, each with the schema version its pages expect. */
  store: Record<string, { schemaVersion: number }>
  /** Background scripts, relative to the kit's folder. */
  scripts: string[]
  /** What it reads outside its own store: "notes", "sources", "thats", "kit:<name>". */
  reads: string[]
  /** Hosts `kit.fetch` may reach. */
  net: string[]
  /** Host abilities it uses beyond its store. */
  needs: KitNeed[]
}

export const KIT_NEEDS = ['that.receive', 'agent.ask', 'srs.schedule', 'speak'] as const
export type KitNeed = (typeof KIT_NEEDS)[number]

const NAME = /^[a-z][a-z0-9-]{0,39}$/
const READS = /^(notes|sources|thats|kit:[a-z][a-z0-9-]{0,39})$/
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Sheets are at least this big, and at most this big, at 100%. */
const MIN = { w: 200, h: 160 }
const MAX = { w: 2000, h: 2000 }

/** Reads a manifest, or says in plain words what is wrong with it. */
export function parseManifest(value: unknown): KitManifest {
  const fail = (what: string): never => {
    throw new Error(`This kit's manifest ${what}.`)
  }
  if (!isRecord(value)) return fail('is not an object')
  const name = value.name
  if (typeof name !== 'string' || !NAME.test(name)) return fail('needs a lower-case name, such as "language"')
  const title = text(value.title) ?? fail('needs a title')
  const description = text(value.description) ?? ''
  const version = value.version ?? 1
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return fail('has a version that is not a whole number from 1')

  if (!Array.isArray(value.sheets) || value.sheets.length === 0) return fail('needs at least one sheet')
  const sheets = value.sheets.map((sheet, at): KitSheet => {
    if (!isRecord(sheet)) return fail(`has a sheet that is not an object (sheet ${at + 1})`)
    const id = sheet.id
    if (typeof id !== 'string' || !NAME.test(id)) return fail(`needs a lower-case id for sheet ${at + 1}`)
    const file = sheet.file
    if (typeof file !== 'string' || !isKitPath(file) || !file.endsWith('.html')) return fail(`needs an .html file inside the kit for sheet "${id}"`)
    const size = isRecord(sheet.size) ? sheet.size : {}
    const w = typeof size.w === 'number' ? size.w : 420
    const h = typeof size.h === 'number' ? size.h : 520
    if (![w, h].every(Number.isFinite) || w < MIN.w || h < MIN.h || w > MAX.w || h > MAX.h) return fail(`gives sheet "${id}" a size outside ${MIN.w}×${MIN.h} to ${MAX.w}×${MAX.h}`)
    return { id, title: text(sheet.title) ?? title, file, size: { w: Math.round(w), h: Math.round(h) } }
  })
  if (new Set(sheets.map((sheet) => sheet.id)).size !== sheets.length) return fail('has two sheets with the same id')

  const store: KitManifest['store'] = {}
  if (value.store !== undefined) {
    if (!isRecord(value.store)) return fail('has a store that is not an object')
    for (const [collection, spec] of Object.entries(value.store)) {
      if (!NAME.test(collection)) return fail(`names a store collection "${collection}" that is not lower-case`)
      const schemaVersion = isRecord(spec) ? spec.schemaVersion : undefined
      if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 1) return fail(`needs a schemaVersion for the store collection "${collection}"`)
      store[collection] = { schemaVersion }
    }
  }

  const scripts = list(value.scripts, 'scripts', fail)
  for (const script of scripts) if (!isKitPath(script) || !script.endsWith('.js')) fail(`names a script "${script}" that is not a .js file inside the kit`)
  const reads = list(value.reads, 'reads', fail)
  for (const read of reads) if (!READS.test(read)) fail(`asks to read "${read}", which is not notes, sources, thats or kit:<name>`)
  const net = list(value.net, 'net', fail)
  for (const host of net) if (!HOST.test(host)) fail(`lists "${host}" in net, which is not a host name`)
  const needs = list(value.needs, 'needs', fail)
  for (const need of needs) if (!(KIT_NEEDS as readonly string[]).includes(need)) fail(`needs "${need}", which kits can't ask for`)

  return { name, title, description, version, sheets, store, scripts, reads, net, needs: needs as KitNeed[] }
}

/** A path inside a kit's folder: relative, with no "..", no backslashes and no odd characters. */
export function isKitPath(path: string): boolean {
  if (path.length === 0 || path.length > 200 || path.startsWith('/')) return false
  return path.split('/').every((part) => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) && part !== '..' && !part.endsWith('.'))
}

function list(value: unknown, field: string, fail: (what: string) => never): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) return fail(`has a ${field} that is not a list of text`)
  return [...new Set(value as string[])]
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, 200) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
