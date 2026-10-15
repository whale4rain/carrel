import type { ItemView, ViewKind } from '../shared/workspace-api.js'

/** How big a new sheet for each kind is at 100%, and the scale it starts at. */
export const SHEET_FOR: Record<ViewKind | 'blank', { w: number; h: number; scale: number }> = {
  blank: { w: 400, h: 300, scale: 1 },
  book: { w: 560, h: 740, scale: 0.6 },
  paper: { w: 560, h: 740, scale: 0.6 },
  web_page: { w: 960, h: 680, scale: 0.6 },
  video: { w: 640, h: 400, scale: 0.8 },
  note: { w: 420, h: 520, scale: 1 },
}

export const KIND_LABEL: Record<ViewKind, string> = {
  book: 'Book',
  paper: 'Paper',
  web_page: 'Web page',
  video: 'Video',
  note: 'Note',
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

const NOUN: Record<ViewKind, string> = {
  book: 'book',
  paper: 'paper',
  web_page: 'web page',
  video: 'video',
  note: 'note',
}

/** What a note cites, in words: "Cites a paper and two videos." */
export function citesLine(cites: readonly string[] | undefined, items: ReadonlyMap<string, ItemView>): string | undefined {
  const counts = new Map<ViewKind, number>()
  for (const id of cites ?? []) {
    const kind = items.get(id)?.kind
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  if (counts.size === 0) return undefined
  const parts = [...counts].map(([kind, n]) => (n === 1 ? `a ${NOUN[kind]}` : `${n} ${NOUN[kind]}s`))
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
  return `Cites ${list}.`
}
