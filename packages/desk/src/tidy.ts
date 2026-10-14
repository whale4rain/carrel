import { bounds, footprint, type Rect, type SheetBox } from './geometry.js'
import { PILE_LABEL } from './piles.js'

/** The gap Tidy up leaves between sheets. */
export const TIDY_GAP = 24

/**
 * Tidy up: lays sheets out in rows, in reading order (top to bottom, then
 * left to right), no wider than `width`, starting where the desk's top-left
 * already is. A pile moves as one, with room for its label. Sizes, scales and
 * stacking stay as they are.
 */
export function tidy<T extends SheetBox>(sheets: readonly T[], width: number, gap = TIDY_GAP): T[] {
  const units = new Map<string, T[]>()
  for (const sheet of sheets) {
    const key = sheet.pile === undefined ? `sheet:${sheet.id}` : `pile:${sheet.pile}`
    units.set(key, [...(units.get(key) ?? []), sheet])
  }
  const boxes = [...units.values()].map((members) => {
    const box = bounds(members.map(footprint))!
    const piled = members[0]!.pile !== undefined
    return { members, box: piled ? { ...box, y: box.y - PILE_LABEL, h: box.h + PILE_LABEL } : box }
  })
  const all = bounds(boxes.map(({ box }) => box))
  if (!all) return []
  boxes.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)

  const moved = new Map<string, T>()
  let x = all.x
  let y = all.y
  let rowHeight = 0
  for (const { members, box } of boxes) {
    if (x > all.x && x + box.w > all.x + width) {
      x = all.x
      y += rowHeight + gap
      rowHeight = 0
    }
    place(members, box, x, y, moved)
    x += box.w + gap
    rowHeight = Math.max(rowHeight, box.h)
  }
  return sheets.map((sheet) => moved.get(sheet.id) ?? sheet)
}

function place<T extends SheetBox>(members: readonly T[], box: Rect, x: number, y: number, into: Map<string, T>): void {
  const dx = Math.round(x - box.x)
  const dy = Math.round(y - box.y)
  for (const sheet of members) into.set(sheet.id, { ...sheet, x: sheet.x + dx, y: sheet.y + dy })
}
