// Sheet geometry in desk units. A sheet keeps its full size (w, h) and a
// scale; what it covers on the desk, its footprint, is the size times the
// scale. Positions are the footprint's top-left corner.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SheetBox extends Rect {
  id: string
  /** 0.3 to 1. */
  scale: number
  /** Stacking order; higher draws on top. */
  z: number
  /** The pile it lies in, if any. */
  pile?: string
  /** Folded down to its label row; it keeps its size for when it opens. */
  folded?: boolean
}

export const MIN_SCALE = 0.3
export const MAX_SCALE = 1
/** The smallest a sheet can be, at 100%. */
export const MIN_W = 160
export const MIN_H = 120
/** A folded sheet's height at 100%: its label row. */
export const FOLDED_H = 36

export function footprint(sheet: SheetBox): Rect {
  return { x: sheet.x, y: sheet.y, w: sheet.w * sheet.scale, h: (sheet.folded ? FOLDED_H : sheet.h) * sheet.scale }
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(scale * 100) / 100))
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** The smallest rectangle around all of them. */
export function bounds(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined
  const left = Math.min(...rects.map((r) => r.x))
  const top = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.w))
  const bottom = Math.max(...rects.map((r) => r.y + r.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** A rectangle from two corners, in any order (a marquee). */
export function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
}
