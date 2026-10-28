import type { NewCapture } from '@carrel/memory'
import type { KeepChoice, KeepOffer } from '../shared/memory-api.js'

/** What ⌘⇧K found when it was pressed, in full: the window only sees a preview. */
export interface Gathered {
  page?: { url: string; title: string; text: string }
  selection?: string
  copied?: string
  /** The screen, as a PNG. */
  screen?: Uint8Array
}

/** Longest copied text offered; a bigger clipboard is probably not words to keep. */
const COPIED_MAX = 20_000

/** What the Keep window is offered, from what was found. */
export function offerOf(gathered: Gathered, screenshot?: string): KeepOffer {
  const offer: KeepOffer = {}
  if (gathered.page) offer.page = { url: gathered.page.url, title: gathered.page.title }
  if (gathered.selection?.trim()) offer.selection = gathered.selection.trim()
  const copied = gathered.copied?.trim()
  if (copied && copied.length <= COPIED_MAX && copied !== offer.selection) offer.copied = copied
  if (screenshot) offer.screenshot = screenshot
  return offer
}

/**
 * The capture for what you chose to keep. A screenshot's file is kept first,
 * and named by `image`. Throws when the choice isn't on offer.
 */
export function captureFor(choice: KeepChoice, gathered: Gathered, reason: string, image?: string, now: Date = new Date()): NewCapture {
  const why = reason.trim()
  const reasonPart = why ? { reason: why } : {}
  const page = gathered.page
  if (choice === 'page' && page) return { kind: 'page', from: 'keep', title: page.title || page.url, text: page.text, url: page.url, ...reasonPart }
  if (choice === 'selection' && gathered.selection?.trim()) {
    const text = gathered.selection.trim()
    return { kind: 'selection', from: 'keep', title: page?.title || firstWords(text), text, ...(page ? { url: page.url } : {}), ...reasonPart }
  }
  if (choice === 'copied' && gathered.copied?.trim()) {
    const text = gathered.copied.trim()
    return { kind: 'selection', from: 'keep', title: firstWords(text), text, ...reasonPart }
  }
  if (choice === 'screenshot' && image) {
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    return { kind: 'screenshot', from: 'keep', title: why || `Screenshot at ${time}`, text: why, image, ...reasonPart }
  }
  throw new Error('That is not there to keep any more.')
}

function firstWords(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}
