import { intersects, type Rect } from './geometry.js'

// The one-live-view rule. A web page is a native view drawn above the whole
// window: it can't be overlapped by DOM, clipped or rotated. So at most one
// web sheet is live, and only when nothing would have to draw over it; every
// other web sheet shows a snapshot. Scale isn't a blocker: the page zooms
// to match its sheet.

/** A sheet as it is on screen right now, in window pixels. */
export interface LiveSheet {
  id: string
  web: boolean
  /** The whole sheet. */
  box: Rect
  /** Where the page goes: the sheet below its label. */
  page: Rect
  z: number
}

export interface LiveState {
  sheets: readonly LiveSheet[]
  /** The web sheet the person last clicked into. */
  active: string | undefined
  /** A gesture is under way; a native view can't follow at 60 fps. */
  moving: boolean
  /** The desk's area of the window. */
  desk: Rect
  /** Things drawn over the desk (menus, the selection bar, the map). */
  overlays: readonly Rect[]
}

export type LiveBlocker = 'none-active' | 'not-web' | 'moving' | 'off-desk' | 'covered'

export type LiveDecision = { live: string } | { live: undefined; reason: LiveBlocker }

export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
}

/** Which web sheet, if any, gets the live view. */
export function pickLive(state: LiveState): LiveDecision {
  const active = state.sheets.find((sheet) => sheet.id === state.active)
  if (!active) return { live: undefined, reason: 'none-active' }
  if (!active.web) return { live: undefined, reason: 'not-web' }
  if (state.moving) return { live: undefined, reason: 'moving' }
  if (!contains(state.desk, active.page)) return { live: undefined, reason: 'off-desk' }
  const covered =
    state.sheets.some((other) => other.id !== active.id && other.z > active.z && intersects(other.box, active.page)) ||
    state.overlays.some((overlay) => intersects(overlay, active.page))
  if (covered) return { live: undefined, reason: 'covered' }
  return { live: active.id }
}
