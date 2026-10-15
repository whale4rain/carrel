import { describe, expect, it } from 'vitest'
import { changed, foldTo, inMarquee, footprint, move, placeNew, raise, resize, scaleTo, snap, type SheetBox } from '../src/index.js'

const sheet = (id: string, over: Partial<SheetBox> = {}): SheetBox => ({ id, x: 0, y: 0, w: 400, h: 300, scale: 1, z: 1, ...over })

describe('footprint', () => {
  it('is the size times the scale', () => {
    expect(footprint(sheet('a', { x: 10, y: 20, scale: 0.5 }))).toEqual({ x: 10, y: 20, w: 200, h: 150 })
  })

  it('is only the label row when folded', () => {
    expect(footprint(sheet('a', { scale: 0.5, folded: true }))).toEqual({ x: 0, y: 0, w: 200, h: 18 })
  })
})

describe('foldTo', () => {
  it('folds the chosen sheets and opens them again at their size', () => {
    const folded = foldTo([sheet('a'), sheet('b')], new Set(['b']), true)
    expect(folded.map((s) => s.folded)).toEqual([undefined, true])
    const opened = foldTo(folded, new Set(['b']), false)
    expect(opened[1]).toEqual(sheet('b'))
    expect('folded' in opened[1]!).toBe(false)
  })

  it('leaves sheets already that way untouched', () => {
    const sheets = [sheet('a')]
    expect(foldTo(sheets, new Set(['a']), false)[0]).toBe(sheets[0])
  })
})

describe('move', () => {
  it('moves only the chosen sheets', () => {
    const moved = move([sheet('a'), sheet('b')], new Set(['b']), 30, -10)
    expect(moved.map((s) => [s.x, s.y])).toEqual([
      [0, 0],
      [30, -10],
    ])
  })
})

describe('resize', () => {
  it('grows from the bottom-right corner', () => {
    expect(resize(sheet('a'), 'se', 40, 20)).toMatchObject({ x: 0, y: 0, w: 440, h: 320 })
  })

  it('keeps the right edge put when dragging the left handle', () => {
    const resized = resize(sheet('a', { x: 100 }), 'w', 50, 0)
    expect(resized).toMatchObject({ x: 150, w: 350 })
    expect(resized.x + resized.w).toBe(500)
  })

  it('works in footprint units on a scaled sheet', () => {
    // At 50%, dragging 50 px on the desk adds 100 units to the sheet.
    const resized = resize(sheet('a', { scale: 0.5 }), 'e', 50, 0)
    expect(resized.w).toBe(500)
    expect(footprint(resized).w).toBe(250)
  })

  it('stops at the minimum size without moving the opposite edge', () => {
    const resized = resize(sheet('a', { x: 0, y: 0 }), 'nw', 1000, 1000)
    expect(resized).toMatchObject({ w: 160, h: 120, x: 240, y: 180 })
  })
})

describe('scaleTo', () => {
  it('keeps the scale between 30% and 100%', () => {
    expect(scaleTo([sheet('a')], new Set(['a']), 0.1)[0]?.scale).toBe(0.3)
    expect(scaleTo([sheet('a')], new Set(['a']), 2)[0]?.scale).toBe(1)
    expect(scaleTo([sheet('a')], new Set(['a']), 0.654)[0]?.scale).toBe(0.65)
  })
})

describe('raise', () => {
  it('brings sheets to the top in their own order', () => {
    const raised = raise([sheet('a', { z: 1 }), sheet('b', { z: 2 }), sheet('c', { z: 3 })], new Set(['a']))
    expect(raised.map((s) => [s.id, s.z])).toEqual([
      ['a', 4],
      ['b', 2],
      ['c', 3],
    ])
  })

  it('leaves the top sheet alone', () => {
    const sheets = [sheet('a', { z: 1 }), sheet('b', { z: 2 })]
    expect(raise(sheets, new Set(['b']))).toEqual(sheets)
  })
})

describe('placeNew', () => {
  it('cascades past occupied spots', () => {
    expect(placeNew([])).toEqual({ x: 48, y: 48 })
    expect(placeNew([sheet('a', { x: 48, y: 48 })])).toEqual({ x: 80, y: 80 })
  })
})

describe('changed', () => {
  it('lists new and altered sheets only', () => {
    const before = [sheet('a'), sheet('b')]
    const after = [sheet('a'), sheet('b', { x: 5 }), sheet('c')]
    expect(changed(before, after).map((s) => s.id)).toEqual(['b', 'c'])
  })
})

describe('snap', () => {
  const other = { x: 100, y: 100, w: 200, h: 100 }

  it('catches the left edge within 6 px and draws a guide across both', () => {
    const result = snap({ x: 104, y: 260, w: 120, h: 80 }, [other])
    expect(result.dx).toBe(-4)
    expect(result.guides[0]).toEqual({ axis: 'x', at: 100, from: 100, to: 340 })
  })

  it('catches centers too', () => {
    // Moving center 205 → other's center 200.
    expect(snap({ x: 145, y: 400, w: 120, h: 80 }, [other]).dx).toBe(-5)
  })

  it('does nothing beyond the distance', () => {
    expect(snap({ x: 110, y: 400, w: 120, h: 80 }, [other])).toEqual({ dx: 0, dy: 0, guides: [] })
  })

  it('snaps each axis on its own', () => {
    const result = snap({ x: 303, y: 98, w: 100, h: 50 }, [other])
    expect([result.dx, result.dy]).toEqual([-3, 2])
    expect(result.guides.map((g) => g.axis)).toEqual(['x', 'y'])
  })
})

describe('inMarquee', () => {
  it('picks sheets whose footprint the marquee touches', () => {
    const sheets = [sheet('a'), sheet('b', { x: 500, scale: 0.5 }), sheet('c', { x: 1000 })]
    expect(inMarquee(sheets, { x: 390, y: 10, w: 120, h: 20 })).toEqual(['a', 'b'])
    expect(inMarquee(sheets, { x: 710, y: 0, w: 200, h: 200 })).toEqual([])
  })
})
