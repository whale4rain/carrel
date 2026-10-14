import { describe, expect, it } from 'vitest'
import { pickLive, viewBounds, type DeskState, type SheetLayout } from '../src/live-policy.ts'

const HEADER = 28
const web = (id: string, x: number, y: number, z: number, scale = 1): SheetLayout => ({
  id,
  kind: 'web',
  rect: { x, y, width: 400, height: 300 },
  scale,
  z,
})
const note: SheetLayout = { id: 'note', kind: 'note', rect: { x: 900, y: 40, width: 200, height: 200 }, scale: 1, z: 5 }
const viewport = { x: 0, y: 0, width: 1200, height: 800 }

function desk(partial: Partial<DeskState>): DeskState {
  return { sheets: [web('a', 40, 40, 1), web('b', 500, 40, 2), note], activeId: 'a', moving: false, viewport, ...partial }
}

describe('pickLive', () => {
  it('makes the active, uncovered web sheet live', () => {
    expect(pickLive(desk({}), HEADER)).toEqual({ live: 'a', reason: 'active' })
  })

  it('keeps nothing live while a sheet moves', () => {
    expect(pickLive(desk({ moving: true }), HEADER).reason).toBe('moving')
  })

  it('falls back to a snapshot when a higher sheet overlaps the page', () => {
    const sheets = [web('a', 40, 40, 1), web('b', 300, 200, 2), note]
    expect(pickLive(desk({ sheets }), HEADER).reason).toBe('covered')
  })

  it('ignores sheets underneath the active one', () => {
    const sheets = [web('a', 40, 40, 3), web('b', 300, 200, 2), note]
    expect(pickLive(desk({ sheets }), HEADER).live).toBe('a')
  })

  it('stays live when scaled down', () => {
    expect(pickLive(desk({ sheets: [web('a', 40, 40, 1, 0.5), note] }), HEADER).live).toBe('a')
  })

  it('counts a scaled sheet by its scaled size', () => {
    // b would overlap a at full size, but scaled to half it doesn't.
    const sheets = [web('a', 40, 40, 1), web('b', 300, 200, 2, 0.5), note]
    expect(pickLive(desk({ sheets }), HEADER).reason).toBe('covered')
    const smaller = [web('a', 40, 40, 1), web('b', 450, 360, 2, 0.5), note]
    expect(pickLive(desk({ sheets: smaller }), HEADER).live).toBe('a')
  })

  it('needs the page fully on the desk', () => {
    expect(pickLive(desk({ sheets: [web('a', -20, 40, 1)] }), HEADER).reason).toBe('off-desk')
  })

  it('has nothing live for a note', () => {
    expect(pickLive(desk({ activeId: 'note' }), HEADER).reason).toBe('not-web')
  })
})

describe('viewBounds', () => {
  it('places the view under the header, scaled, in window coordinates', () => {
    expect(viewBounds(web('a', 40.4, 40, 1, 0.5), HEADER, { x: 240, y: 52 })).toEqual({
      x: 280,
      y: 106,
      width: 200,
      height: 136,
    })
  })
})
