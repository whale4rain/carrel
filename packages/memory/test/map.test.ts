import { describe, expect, it } from 'vitest'
import { CARD, LOOSE_ENDS, mapLayout, rangeStart, type Line, type Piece } from '../src/index.js'

function piece(id: string, day: string, group: string): Piece {
  return { id, day, title: id, body: '', group, source: { label: 'Blog', kind: 'page', from: 'keep', title: id, at: `${day}T10:00:00.000Z` }, captures: [], createdAt: `${day}T21:00:00.000Z` }
}

function line(id: string, from: string, to: string, drawnOn: string, removedAt?: string): Line {
  return { id, from, to, relation: 'builds on', drawnOn, drawnAt: `${drawnOn}T21:00:00.000Z`, ...(removedAt ? { removedAt } : {}) }
}

const today = '2026-10-23'

describe('map layout', () => {
  it('places pieces by day, left to right, in bands by group with loose ends last', () => {
    const pieces = [piece('a', '2026-10-10', 'Inference'), piece('b', '2026-10-19', 'Inference'), piece('c', '2026-10-11', LOOSE_ENDS), piece('d', '2026-10-12', 'Algorithms'), piece('e', today, 'Inference')]
    const map = mapLayout(pieces, [], { today, first: rangeStart('2w', today), width: 1000 })
    expect(map.first).toBe('2026-10-10')
    expect(map.bands.map((band) => band.name)).toEqual(['Inference', 'Algorithms', LOOSE_ENDS])
    const at = new Map(map.cards.map((card) => [card.piece.id, card]))
    expect(at.get('a')!.x).toBeLessThan(at.get('b')!.x)
    expect(at.get('b')!.x).toBeLessThan(at.get('e')!.x)
    expect(at.get('e')!.today).toBe(true)
    expect(at.get('e')!.x + CARD.width).toBeLessThanOrEqual(map.width)
    // A narrow window scrolls sideways rather than squeezing two weeks.
    expect(mapLayout(pieces, [], { today, first: rangeStart('2w', today), width: 500 }).width).toBeGreaterThan(900)
    expect(map.ticks.at(-1)).toMatchObject({ day: today, label: 'Today' })
  })

  it('ends the axis at Today when every piece is from today', () => {
    const pieces = [piece('a', today, 'Inference')]
    const map = mapLayout(pieces, [], { today, first: rangeStart('all', today, pieces), width: 1000 })
    expect(map.ticks).toHaveLength(1)
    expect(map.ticks.at(-1)).toMatchObject({ day: today, label: 'Today' })
  })

  it('stacks cards of one group that would overlap', () => {
    const pieces = [piece('a', '2026-10-20', 'Inference'), piece('b', '2026-10-20', 'Inference'), piece('c', '2026-10-21', 'Inference')]
    const map = mapLayout(pieces, [], { today, first: rangeStart('2w', today), width: 900 })
    const ys = new Set(map.cards.map((card) => card.y))
    expect(ys.size).toBe(3)
  })

  it('draws shown lines between cards in range, fresh ones last', () => {
    const pieces = [piece('a', '2026-10-15', 'Inference'), piece('b', '2026-10-19', 'Inference'), piece('c', today, 'Inference'), piece('old', '2026-09-01', 'Inference')]
    const lines = [line('l1', 'c', 'b', today), line('l2', 'b', 'a', '2026-10-19'), line('gone', 'c', 'a', today, '2026-10-23T22:00:00.000Z'), line('out', 'a', 'old', '2026-10-15')]
    const map = mapLayout(pieces, lines, { today, first: rangeStart('2w', today), width: 1000 })
    expect(map.lines.map((drawn) => [drawn.line.id, drawn.fresh])).toEqual([
      ['l2', false],
      ['l1', true],
    ])
    expect(map.lines[0]!.d).toMatch(/^M [\d.]+ [\d.]+ C /)
    const all = mapLayout(pieces, lines, { today, first: rangeStart('all', today, pieces), width: 1000 })
    expect(all.first).toBe('2026-09-01')
    expect(all.lines).toHaveLength(3)
  })
})
