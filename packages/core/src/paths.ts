import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where Carrel keeps things on disk (decided 14 Oct).
 *
 * - `content`: your projects, visible and safe to sync (`~/Carrel`).
 * - `internal`: app internals such as settings, kits, the search index,
 *   caches and logs (`~/.carrel`). SQLite never goes in `content`.
 */
export interface CarrelRoots {
  content: string
  internal: string
}

export function carrelRoots(home: string = homedir()): CarrelRoots {
  return {
    content: join(home, 'Carrel'),
    internal: join(home, '.carrel'),
  }
}

// Characters that are invalid in file names on Windows or macOS.
const RESERVED = /[<>:"/\\|?*]/
// Names Windows refuses for a file or folder, with or without an extension.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** Throws when `name` can't be a project folder on both Mac and Windows. */
export function assertProjectName(name: string): void {
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error('A project name cannot be empty.')
  if (trimmed !== name) throw new Error('A project name cannot start or end with spaces.')
  if (name === '.' || name === '..') throw new Error(`"${name}" is not a valid project name.`)
  if (name.endsWith('.')) throw new Error('A project name cannot end with a dot.')
  if (RESERVED.test(name) || hasControlCharacter(name)) {
    throw new Error(`"${name}" contains a character that is not allowed in a folder name.`)
  }
  if (WINDOWS_RESERVED.test(name)) throw new Error(`"${name}" is a reserved name on Windows.`)
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    if ((char.codePointAt(0) ?? 0) < 0x20) return true
  }
  return false
}

/** The visible folder for one project: `~/Carrel/<project>/`. */
export function projectDir(name: string, roots: CarrelRoots = carrelRoots()): string {
  assertProjectName(name)
  return join(roots.content, name)
}
