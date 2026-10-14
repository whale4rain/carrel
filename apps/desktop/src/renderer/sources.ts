import type { ItemKind, ItemView } from '../shared/workspace-api.js'

/** How big a new sheet for each kind is at 100%, and the scale it starts at. */
export const SHEET_FOR: Record<ItemKind | 'blank', { w: number; h: number; scale: number }> = {
  blank: { w: 400, h: 300, scale: 1 },
  book: { w: 560, h: 740, scale: 0.6 },
  paper: { w: 560, h: 740, scale: 0.6 },
  web_page: { w: 960, h: 680, scale: 0.6 },
  video: { w: 640, h: 400, scale: 0.8 },
}

export const KIND_LABEL: Record<ItemKind, string> = {
  book: 'Book',
  paper: 'Paper',
  web_page: 'Web page',
  video: 'Video',
}

/** "PDF · 1.2 MB", or the link's host. */
export function sourceLine(item: ItemView): string {
  if (item.file) return `PDF · ${size(item.file.size)}`
  if (item.url) return new URL(item.url).hostname.replace(/^www\./, '')
  return ''
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A dropped or pasted text that is a link Carrel can add. */
export function linkIn(text: string): string | undefined {
  const trimmed = text.trim()
  if (/\s/.test(trimmed)) return undefined
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}
