import { describe, expect, it } from 'vitest'
import { footprint, intersects, makePile, PILE_LABEL, tidy, TIDY_GAP, type SheetBox } from '../src/index.js'

const sheet = (id: string, over: Partial<SheetBox> = {}): SheetBox => ({ id, x: 0, y: 0, w: 400, h: 300, scale: 1, z: 1, ...over })

describe('tidy', () => {
  it('lays sheets out in rows in reading order, from the desk top-left', () => {
    const messy = [sheet('c', { x: 300, y: 500 }), sheet('a', { x: 40, y: 20, scale: 0.5 }), sheet('b', { x: 500, y: 30 })]
    const tidied = tidy(messy, 1000)
    const at = Object.fromEntries(tidied.map((s) => [s.id, [s.x, s.y]]))
    expect(at).toEqual({ a: [40, 20], b: [40 + 200 + TIDY_GAP, 20], c: [40, 20 + 300 + TIDY_GAP] })
  })

  it('leaves no overlaps', () => {
    const messy = Array.from({ length: 9 }, (_, i) => sheet(`s${i}`, { x: (i * 37) % 200, y: (i * 53) % 150, scale: i % 2 ? 0.6 : 1 }))
    const tidied = tidy(messy, 1200).map(footprint)
    for (let i = 0; i < tidied.length; i++) for (let j = i + 1; j < tidied.length; j++) expect(intersects(tidied[i]!, tidied[j]!)).toBe(false)
  })

  it('moves a pile as one, keeping room for its label', () => {
    const desk = makePile([sheet('a', { x: 0, y: 100 }), sheet('b', { x: 50, y: 100 }), sheet('c', { x: 900, y: 0 })], new Set(['a', 'b']), 'p')
    const tidied = tidy(desk, 2000)
    const [a, b, c] = tidied as [SheetBox, SheetBox, SheetBox]
    expect(b.x - a.x).toBe(desk[1]!.x - desk[0]!.x)
    expect(c.y).toBe(0)
    expect(a.y - PILE_LABEL).toBe(0)
  })

  it('keeps sizes, scales and order', () => {
    const messy = [sheet('a', { x: 600, z: 2, scale: 0.4 }), sheet('b', { z: 1 })]
    expect(tidy(messy, 2000).map(({ id, w, h, scale, z }) => ({ id, w, h, scale, z }))).toEqual(messy.map(({ id, w, h, scale, z }) => ({ id, w, h, scale, z })))
  })
})
