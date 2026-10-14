import type { Rect } from './geometry.js'

// Snap guides: while a sheet moves, its left, center or right edge (and top,
// middle or bottom) catches on another sheet's matching lines within a few
// pixels. The guide is drawn across both sheets.

export interface Guide {
  axis: 'x' | 'y'
  /** Where the line is, on its axis. */
  at: number
  /** Its extent along the other axis. */
  from: number
  to: number
}

export interface Snapped {
  dx: number
  dy: number
  guides: Guide[]
}

/** 6 px on screen, as the design says. Pass it divided by zoom for desk units. */
export const SNAP_DISTANCE = 6

const lines = (start: number, size: number): number[] => [start, start + size / 2, start + size]

/**
 * How far to nudge `moving` so it lines up with one of `others`, on each axis
 * independently, and the guides to show. No nudge beyond `distance`.
 */
export function snap(moving: Rect, others: readonly Rect[], distance = SNAP_DISTANCE): Snapped {
  const x = nearest(lines(moving.x, moving.w), others.flatMap((o) => lines(o.x, o.w)), distance)
  const y = nearest(lines(moving.y, moving.h), others.flatMap((o) => lines(o.y, o.h)), distance)
  const placed = { ...moving, x: moving.x + (x?.delta ?? 0), y: moving.y + (y?.delta ?? 0) }
  const guides: Guide[] = []
  if (x) {
    const span = others.filter((o) => lines(o.x, o.w).some((line) => near(line, x.at))).concat(placed)
    guides.push({ axis: 'x', at: x.at, from: Math.min(...span.map((r) => r.y)), to: Math.max(...span.map((r) => r.y + r.h)) })
  }
  if (y) {
    const span = others.filter((o) => lines(o.y, o.h).some((line) => near(line, y.at))).concat(placed)
    guides.push({ axis: 'y', at: y.at, from: Math.min(...span.map((r) => r.x)), to: Math.max(...span.map((r) => r.x + r.w)) })
  }
  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, guides }
}

function nearest(mine: number[], theirs: number[], distance: number): { delta: number; at: number } | undefined {
  let best: { delta: number; at: number } | undefined
  for (const line of mine) {
    for (const target of theirs) {
      const delta = target - line
      if (Math.abs(delta) <= distance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: target }
    }
  }
  return best
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.5
}
