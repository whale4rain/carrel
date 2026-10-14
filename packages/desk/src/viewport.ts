import type { Rect } from './geometry.js'

// The view onto a desk: screen = desk × zoom + (x, y). The desk itself is
// unbounded; the view is per desk and saved with it.

export interface View {
  x: number
  y: number
  zoom: number
}

export interface Point {
  x: number
  y: number
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2
/** Each zoom step multiplies or divides by this. */
export const ZOOM_STEP = 1.25

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100))
}

export function toDesk(view: View, at: Point): Point {
  return { x: (at.x - view.x) / view.zoom, y: (at.y - view.y) / view.zoom }
}

export function toScreen(view: View, at: Point): Point {
  return { x: at.x * view.zoom + view.x, y: at.y * view.zoom + view.y }
}

export function rectToScreen(view: View, rect: Rect): Rect {
  const at = toScreen(view, rect)
  return { x: at.x, y: at.y, w: rect.w * view.zoom, h: rect.h * view.zoom }
}

/** Zooms keeping the desk point under `at` (screen) where it is. */
export function zoomAt(view: View, at: Point, zoom: number): View {
  const next = clampZoom(zoom)
  const anchor = toDesk(view, at)
  return { zoom: next, x: at.x - anchor.x * next, y: at.y - anchor.y * next }
}

/** The next zoom in or out; a step that would cross 100% stops there. */
export function zoomStep(zoom: number, direction: 1 | -1): number {
  const next = clampZoom(direction > 0 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP)
  if ((zoom < 1 && next > 1) || (zoom > 1 && next < 1)) return 1
  return next
}

/** The part of the desk a screen of this size shows. */
export function visibleRect(view: View, width: number, height: number): Rect {
  const at = toDesk(view, { x: 0, y: 0 })
  return { x: at.x, y: at.y, w: width / view.zoom, h: height / view.zoom }
}

/** A view that shows all of `rect` with some room around it, never above 100%. */
export function fitView(rect: Rect, width: number, height: number, padding = 48): View {
  const zoom = clampZoom(Math.min(1, (width - padding * 2) / Math.max(1, rect.w), (height - padding * 2) / Math.max(1, rect.h)))
  return { zoom, x: (width - rect.w * zoom) / 2 - rect.x * zoom, y: (height - rect.h * zoom) / 2 - rect.y * zoom }
}
