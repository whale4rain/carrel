import { describe, expect, it } from 'vitest'
import { makePile, PILE_LABEL, PILE_SCALE, PILE_STEP, piles, spread, SPREAD_GAP, withPiles, type SheetBox } from '../src/index.js'

const sheet = (id: string, over: Partial<SheetBox> = {}): SheetBox => ({ id, x: 0, y: 0, w: 400, h: 300, scale: 1, z: 1, ...over })

describe('makePile', () => {
  const desk = [sheet('a', { x: 100, y: 80, z: 2 }), sheet('b', { x: 600, y: 40, z: 1 }), sheet('c', { x: 900, z: 3 })]
  const piled = makePile(desk, new Set(['a', 'b']), 'p')

  it('stacks the chosen sheets at 30% from the selection top-left, keeping their order', () => {
    const [a, b] = [piled[0]!, piled[1]!]
    expect(b).toMatchObject({ pile: 'p', scale: PILE_SCALE, x: 100, y: 40 + PILE_LABEL })
    expect(a).toMatchObject({ pile: 'p', scale: PILE_SCALE, x: 100 + PILE_STEP.x, y: 40 + PILE_LABEL + PILE_STEP.y })
    expect(a.z).toBeGreaterThan(b.z)
    expect(b.z).toBeGreaterThan(3)
  })

  it('leaves the others alone', () => {
    expect(piled[2]).toBe(desk[2])
  })

  it('needs two sheets', () => {
    expect(makePile(desk, new Set(['a']), 'p')).toEqual(desk)
  })

  it('is found again, and chosen whole', () => {
    expect(piles(piled).get('p')?.map((s) => s.id)).toEqual(['b', 'a'])
    expect([...withPiles(piled, ['a'])].sort()).toEqual(['a', 'b'])
    expect([...withPiles(piled, ['c'])]).toEqual(['c'])
  })

  it('spreads out in a row where it was', () => {
    const spreadOut = spread(piled, 'p')
    const [a, b] = [spreadOut[0]!, spreadOut[1]!]
    expect(b).toEqual({ id: 'b', x: 100, y: 40, w: 400, h: 300, scale: PILE_SCALE, z: b.z })
    expect(a).toMatchObject({ x: 100 + 400 * PILE_SCALE + SPREAD_GAP, y: 40 })
    expect('pile' in a).toBe(false)
  })
})
