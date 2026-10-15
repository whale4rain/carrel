import { clampScale, footprint, intersects, MIN_H, MIN_W, type Rect, type SheetBox } from './geometry.js'

// Changes to sheets. Each returns new sheets and leaves the input alone, so a
// gesture can be previewed from its starting state and undone by keeping it.

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const handles: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function move<T extends SheetBox>(sheets: readonly T[], ids: ReadonlySet<string>, dx: number, dy: number): T[] {
  return sheets.map((sheet) => (ids.has(sheet.id) ? { ...sheet, x: round(sheet.x + dx), y: round(sheet.y + dy) } : sheet))
}

/**
 * Drags one handle by (dx, dy) on the desk. The opposite edges stay put, and
 * the sheet never gets smaller than the minimum size.
 */
export function resize<T extends SheetBox>(sheet: T, handle: Handle, dx: number, dy: number): T {
  const s = sheet.scale
  let { x, y, w, h } = sheet
  if (handle.includes('e')) w = Math.max(MIN_W, w + dx / s)
  if (handle.includes('s')) h = Math.max(MIN_H, h + dy / s)
  if (handle.includes('w')) {
    const next = Math.max(MIN_W, w - dx / s)
    x += (w - next) * s
    w = next
  }
  if (handle.includes('n')) {
    const next = Math.max(MIN_H, h - dy / s)
    y += (h - next) * s
    h = next
  }
  return { ...sheet, x: round(x), y: round(y), w: round(w), h: round(h) }
}

/** Scales sheets about their top-left corners, within 30–100%. */
export function scaleTo<T extends SheetBox>(sheets: readonly T[], ids: ReadonlySet<string>, scale: number): T[] {
  const next = clampScale(scale)
  return sheets.map((sheet) => (ids.has(sheet.id) ? { ...sheet, scale: next } : sheet))
}

/** Folds sheets down to their label rows, or opens them again. */
export function foldTo<T extends SheetBox>(sheets: readonly T[], ids: ReadonlySet<string>, folded: boolean): T[] {
  return sheets.map((sheet) => {
    if (!ids.has(sheet.id) || (sheet.folded ?? false) === folded) return sheet
    if (folded) return { ...sheet, folded: true }
    const open = { ...sheet }
    delete open.folded
    return open
  })
}

/** Brings sheets to the top, keeping their order among themselves. */
export function raise<T extends SheetBox>(sheets: readonly T[], ids: ReadonlySet<string>): T[] {
  const top = Math.max(0, ...sheets.map((sheet) => sheet.z))
  const raised = sheets.filter((sheet) => ids.has(sheet.id)).sort((a, b) => a.z - b.z)
  if (raised.every((sheet, i) => sheet.z === top - raised.length + 1 + i)) return [...sheets]
  const order = new Map(raised.map((sheet, i) => [sheet.id, top + 1 + i]))
  return sheets.map((sheet) => {
    const z = order.get(sheet.id)
    return z === undefined ? sheet : { ...sheet, z }
  })
}

/** Where a new sheet goes: the next free cascade spot from the top-left. */
export function placeNew(sheets: readonly SheetBox[], origin = { x: 48, y: 48 }): { x: number; y: number } {
  const step = 32
  for (let i = 0; i < 50; i++) {
    const spot = { x: origin.x + i * step, y: origin.y + i * step }
    if (!sheets.some((sheet) => Math.abs(sheet.x - spot.x) < 4 && Math.abs(sheet.y - spot.y) < 4)) return spot
  }
  return origin
}

/** Changed sheets only: what an event needs to record. */
export function changed<T extends SheetBox>(before: readonly T[], after: readonly T[]): T[] {
  const old = new Map(before.map((sheet) => [sheet.id, sheet]))
  return after.filter((sheet) => {
    const prior = old.get(sheet.id)
    return !prior || JSON.stringify(prior) !== JSON.stringify(sheet)
  })
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/** Ids of the sheets a marquee touches. */
export function inMarquee(sheets: readonly SheetBox[], marquee: Rect): string[] {
  return sheets.filter((sheet) => intersects(footprint(sheet), marquee)).map((sheet) => sheet.id)
}

/** The scales the selection bar offers. */
export const SCALES: readonly number[] = [1, 0.8, 0.6, 0.4, 0.3]
