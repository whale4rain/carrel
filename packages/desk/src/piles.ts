import { bounds, footprint, type SheetBox } from './geometry.js'

// Piles: a stack of sheets at 30%, cascaded, with a label above. A sheet in a
// pile carries the pile's id; the pile's place is its first sheet's.

/** Sheets in a pile shrink to this. */
export const PILE_SCALE = 0.3
/** How far each sheet in a pile sits from the one below. */
export const PILE_STEP = { x: 30, y: 22 }
/** Room above a pile for its label. */
export const PILE_LABEL = 26
/** The gap between sheets when a pile is spread out. */
export const SPREAD_GAP = 24

/** Stacks the chosen sheets into a pile at the selection's top-left, keeping their order. */
export function makePile<T extends SheetBox>(sheets: readonly T[], ids: ReadonlySet<string>, pile: string): T[] {
  const chosen = sheets.filter((sheet) => ids.has(sheet.id)).sort((a, b) => a.z - b.z)
  const around = bounds(chosen.map(footprint))
  if (!around || chosen.length < 2) return [...sheets]
  const top = Math.max(0, ...sheets.map((sheet) => sheet.z))
  const placed = new Map(
    chosen.map((sheet, i) => [
      sheet.id,
      { ...sheet, pile, scale: PILE_SCALE, x: around.x + i * PILE_STEP.x, y: around.y + PILE_LABEL + i * PILE_STEP.y, z: top + i + 1 },
    ]),
  )
  return sheets.map((sheet) => placed.get(sheet.id) ?? sheet)
}

/** A pile's sheets, bottom to top. */
export function pileOf<T extends SheetBox>(sheets: readonly T[], pile: string): T[] {
  return sheets.filter((sheet) => sheet.pile === pile).sort((a, b) => a.z - b.z)
}

/** Every pile on the desk, with its sheets bottom to top. */
export function piles<T extends SheetBox>(sheets: readonly T[]): Map<string, T[]> {
  const found = new Map<string, T[]>()
  for (const sheet of [...sheets].sort((a, b) => a.z - b.z)) {
    if (sheet.pile === undefined) continue
    found.set(sheet.pile, [...(found.get(sheet.pile) ?? []), sheet])
  }
  return found
}

/** The ids with every pile they touch filled in: a pile is chosen whole. */
export function withPiles(sheets: readonly SheetBox[], ids: Iterable<string>): Set<string> {
  const chosen = new Set(ids)
  const touched = new Set(sheets.filter((sheet) => chosen.has(sheet.id) && sheet.pile !== undefined).map((sheet) => sheet.pile))
  for (const sheet of sheets) if (sheet.pile !== undefined && touched.has(sheet.pile)) chosen.add(sheet.id)
  return chosen
}

/** Lays a pile's sheets out in a row where the pile was, at their own scale, and ends the pile. */
export function spread<T extends SheetBox>(sheets: readonly T[], pile: string): T[] {
  const members = pileOf(sheets, pile)
  const first = members[0]
  if (!first) return [...sheets]
  let x = first.x
  const y = first.y - PILE_LABEL
  const placed = new Map<string, T>()
  for (const sheet of members) {
    const next = { ...sheet, x, y }
    delete next.pile
    placed.set(sheet.id, next)
    x += sheet.w * sheet.scale + SPREAD_GAP
  }
  return sheets.map((sheet) => placed.get(sheet.id) ?? sheet)
}
