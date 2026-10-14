// Videos on the desk: which links get an embedded player, and how its time reads.
import type { ItemView } from '../shared/workspace-api.js'

/** The YouTube video id from the usual URL shapes, or undefined. */
export function youtubeId(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  const host = parsed.hostname.replace(/^(www|m)\./, '')
  const path = parsed.pathname.split('/')
  const id =
    host === 'youtu.be'
      ? path[1]
      : host === 'youtube.com' || host === 'youtube-nocookie.com'
        ? path[1] === 'embed' || path[1] === 'shorts' || path[1] === 'live'
          ? path[2]
          : (parsed.searchParams.get('v') ?? undefined)
        : undefined
  return id && /^[\w-]{11}$/.test(id) ? id : undefined
}

/** Where a link starts playing, from `t=` or `start=`, in seconds. */
export function startAt(url: string): number {
  const params = new URL(url).searchParams
  const value = params.get('t') ?? params.get('start')
  if (!value) return 0
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value)
  if (!parts) return 0
  return Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0)
}

export const YOUTUBE_ORIGIN = 'https://www.youtube-nocookie.com'

/** The embed Carrel loads: privacy-enhanced host, JS API on, nothing autoplays. */
export function youtubeEmbedUrl(id: string, origin: string, start = 0): string {
  const params = new URLSearchParams({ enablejsapi: '1', playsinline: '1', rel: '0', origin })
  if (start > 0) params.set('start', String(Math.floor(start)))
  return `${YOUTUBE_ORIGIN}/embed/${id}?${params.toString()}`
}

/**
 * Whether a source plays in an embedded player on its sheet. Videos from
 * sites without a player adapter open like web pages instead, one live at a time.
 */
export function embedded(item: ItemView | undefined): item is ItemView & { url: string } {
  return item?.kind === 'video' && item.url !== undefined && youtubeId(item.url) !== undefined
}

/** A source that shows as a web page on the desk. */
export function asWebPage(item: ItemView | undefined): item is ItemView & { url: string } {
  return item?.url !== undefined && (item.kind === 'web_page' || (item.kind === 'video' && !embedded(item)))
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatTimestamp(seconds: number): string {
  const whole = Math.floor(Math.max(0, seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = String(whole % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
