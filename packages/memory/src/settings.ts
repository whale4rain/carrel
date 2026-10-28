import { join } from 'node:path'
import { readJson, writeJson } from '@carrel/core'
import type { MemoryPaths } from './kept.js'
import { siteOf } from './sites.js'

export { onTrail, siteOf, visitKey } from './sites.js'

/** How memory works on this computer: ~/.carrel/memory/settings.json. */
export interface MemorySettings {
  /** Sites whose pages are recorded as you read them ("arxiv.org", "x.com"). Empty: the trail is off. */
  trail: string[]
  /** The hour (0–23, local) the evening job turns the day into pieces. */
  eveningHour: number
}

export const DEFAULT_SETTINGS: MemorySettings = { trail: [], eveningHour: 21 }

export async function readSettings(paths: MemoryPaths): Promise<MemorySettings> {
  // An unreadable file reads as defaults, so saving can repair it.
  const read = (await readJson(settingsFile(paths)).catch(() => undefined)) as Partial<MemorySettings> | undefined
  return cleanSettings({ ...DEFAULT_SETTINGS, ...read })
}

export async function writeSettings(paths: MemoryPaths, settings: Partial<MemorySettings>): Promise<MemorySettings> {
  const next = cleanSettings({ ...(await readSettings(paths)), ...settings })
  await writeJson(settingsFile(paths), next)
  return next
}

function settingsFile(paths: MemoryPaths): string {
  return join(paths.internal, 'settings.json')
}

function cleanSettings(settings: Partial<MemorySettings>): MemorySettings {
  const trail = Array.isArray(settings.trail) ? [...new Set(settings.trail.flatMap((site) => (typeof site === 'string' ? (siteOf(site) ?? []) : [])))] : []
  const hour = typeof settings.eveningHour === 'number' && Number.isInteger(settings.eveningHour) && settings.eveningHour >= 0 && settings.eveningHour <= 23 ? settings.eveningHour : DEFAULT_SETTINGS.eveningHour
  return { trail, eveningHour: hour }
}
