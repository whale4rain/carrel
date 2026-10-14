// The one-live-view rule, as a pure function so it can be tested without
// Electron. Native web views can't be overlapped by DOM or rotated, so at
// most one web sheet is live; every other web sheet shows a snapshot.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SheetLayout {
  id: string
  kind: 'web' | 'note'
  /** Position and size on the desk at 100%, in CSS pixels. */
  rect: Rect
  /** 0.3 to 1. */
  scale: number
  /** Stacking order; higher draws on top. */
  z: number
}

export interface DeskState {
  sheets: readonly SheetLayout[]
  /** The sheet the user last clicked or focused. */
  activeId: string | undefined
  /** A sheet is being dragged or resized; native views can't follow at 60 fps. */
  moving: boolean
  /** The visible desk area, in desk coordinates. */
  viewport: Rect
}

/** Where a sheet's page area ends up on screen. */
export function screenRect(sheet: SheetLayout, headerHeight: number): Rect {
  return {
    x: sheet.rect.x,
    y: sheet.rect.y + headerHeight * sheet.scale,
    width: sheet.rect.width * sheet.scale,
    height: (sheet.rect.height - headerHeight) * sheet.scale,
  }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

export function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

function footprint(sheet: SheetLayout): Rect {
  return { ...sheet.rect, width: sheet.rect.width * sheet.scale, height: sheet.rect.height * sheet.scale }
}

export type LiveDecision = { live: string; reason: 'active' } | { live: undefined; reason: LiveBlocker }

export type LiveBlocker = 'no-active-sheet' | 'not-web' | 'moving' | 'covered' | 'off-desk'

/**
 * Which web sheet, if any, gets the native view. Scale is not a blocker:
 * the view follows a scaled sheet with a matching zoom factor.
 */
export function pickLive(state: DeskState, headerHeight: number): LiveDecision {
  const active = state.sheets.find((sheet) => sheet.id === state.activeId)
  if (!active) return { live: undefined, reason: 'no-active-sheet' }
  if (active.kind !== 'web') return { live: undefined, reason: 'not-web' }
  if (state.moving) return { live: undefined, reason: 'moving' }
  const page = screenRect(active, headerHeight)
  if (!contains(state.viewport, page)) return { live: undefined, reason: 'off-desk' }
  const covered = state.sheets.some(
    (other) => other.id !== active.id && other.z > active.z && intersects(footprint(other), page),
  )
  if (covered) return { live: undefined, reason: 'covered' }
  return { live: active.id, reason: 'active' }
}

/** Integer bounds for `WebContentsView.setBounds`, from desk to window coordinates. */
export function viewBounds(sheet: SheetLayout, headerHeight: number, deskOrigin: { x: number; y: number }): Rect {
  const page = screenRect(sheet, headerHeight)
  return {
    x: Math.round(deskOrigin.x + page.x),
    y: Math.round(deskOrigin.y + page.y),
    width: Math.round(page.width),
    height: Math.round(page.height),
  }
}
