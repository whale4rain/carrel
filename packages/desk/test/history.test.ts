import { describe, expect, it } from 'vitest'
import { emptyHistory, HISTORY_LIMIT, record, redo, remove, touched, undo, type SheetBox } from '../src/index.js'

const sheet = (id: string, over: Partial<SheetBox> = {}): SheetBox => ({ id, x: 0, y: 0, w: 400, h: 300, scale: 1, z: 1, ...over })

describe('history', () => {
  const a = [sheet('a')]
  const b = [sheet('a', { x: 50 })]
  const c = [sheet('a', { x: 50 }), sheet('b')]

  it('undoes and redoes in order', () => {
    let history = record(record(emptyHistory<SheetBox>(), { kind: 'moved', before: a, after: b }), { kind: 'added', before: b, after: c })
    const first = undo(history)
    expect(first?.sheets).toBe(b)
    expect(first?.step.kind).toBe('added')
    history = first!.history
    const second = undo(history)
    expect(second?.sheets).toBe(a)
    history = second!.history
    expect(undo(history)).toBeUndefined()
    const again = redo(history)
    expect(again?.sheets).toBe(b)
    expect(redo(again!.history)?.sheets).toBe(c)
  })

  it('forgets redo once something new happens', () => {
    const history = undo(record(emptyHistory<SheetBox>(), { kind: 'moved', before: a, after: b }))!.history
    expect(history.future).toHaveLength(1)
    expect(record(history, { kind: 'added', before: a, after: c }).future).toHaveLength(0)
  })

  it('keeps a bounded number of steps', () => {
    let history = emptyHistory<SheetBox>()
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) history = record(history, { kind: 'moved', before: a, after: b })
    expect(history.past).toHaveLength(HISTORY_LIMIT)
  })
})

describe('touched', () => {
  it('lists added, changed and removed sheets', () => {
    const before = [sheet('a'), sheet('b'), sheet('c')]
    const after = [sheet('a'), sheet('b', { x: 1 }), sheet('d')]
    expect(touched(before, after)).toEqual(['b', 'd', 'c'])
  })
})

describe('remove', () => {
  it('drops the chosen sheets', () => {
    expect(remove([sheet('a'), sheet('b')], new Set(['a'])).map((s) => s.id)).toEqual(['b'])
  })
})
