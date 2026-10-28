import { join } from 'node:path'
import { readJson, writeJson } from '@carrel/core'
import type { MemoryPaths } from './kept.js'

/** How memory works on this computer: ~/.carrel/memory/settings.json. */
export interface MemorySettings {
  /** Sites whose pages are recorded as you read them ("arxiv.org", "x.com"). Empty: the trail is off. */
  trail: string[]
  /** The hour (0–23, local) the evening job turns the day into pieces. */
  eveningHour: number
}

export const DEFAULT_SETTINGS: MemorySettings = { trail: [], eveningHour: 21 }

export async function readSettings(paths: MemoryPaths): Promise<MemorySettings> {
  const read = (await readJson(settingsFile(paths))) as Partial<MemorySettings> | undefined
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

/** A site as the trail keeps it: its host, lower-cased, without "www.". "https://www.X.com/home" is "x.com". */
export function siteOf(text: string): string | undefined {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) return undefined
  let host: string
  try {
    host = new URL(/^[a-z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).hostname
  } catch {
    return undefined
  }
  host = host.replace(/^www\./, '')
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : undefined
}

/** Whether a page is on one of the trail's sites (a subdomain counts). Only http and https pages are read. */
export function onTrail(url: string, sites: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  return sites.some((site) => host === site || host.endsWith(`.${site}`))
}

/** A page's address as the trail keys it: without its #fragment, so scrolling to a heading isn't a new visit. */
export function visitKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}
