import { describe, expect, it } from 'vitest'
import { newReview, schedule } from '../src/index.js'

const now = new Date('2026-10-16T09:00:00.000Z')
const days = (state: { due: string }): number => Math.round((Date.parse(state.due) - now.getTime()) / 86_400_000)

describe('schedule', () => {
  it('starts a card at one day, then three, then grows by its ease', () => {
    const first = schedule(null, 'good', now)
    expect(first).toMatchObject({ interval: 1, reps: 1, ease: 2.5, lapses: 0, last: now.toISOString() })
    expect(days(first)).toBe(1)
    const second = schedule(first, 'good', now)
    expect(second.interval).toBe(3)
    expect(schedule(second, 'good', now).interval).toBe(8)
  })

  it('brings a missed card back in ten minutes and makes it grow slower', () => {
    const known = schedule(schedule(null, 'good', now), 'good', now)
    const missed = schedule(known, 'again', now)
    expect(missed).toMatchObject({ interval: 0, reps: 0, lapses: 1, ease: 2.3 })
    expect(Date.parse(missed.due) - now.getTime()).toBe(10 * 60 * 1000)
    expect(schedule(missed, 'good', now).interval).toBe(1)
  })

  it('spaces easy cards further and hard ones closer', () => {
    expect(schedule(null, 'easy', now)).toMatchObject({ interval: 4, ease: 2.65 })
    expect(schedule(null, 'hard', now)).toMatchObject({ interval: 1, ease: 2.35 })
    const often = schedule(schedule(null, 'good', now), 'good', now)
    expect(schedule(often, 'hard', now).interval).toBe(4)
    expect(schedule(often, 'easy', now).interval).toBe(10)
  })

  it('keeps the ease above 1.3 and the gap under a year', () => {
    let state = newReview(now)
    for (let i = 0; i < 20; i++) state = schedule(state, 'again', now)
    expect(state.ease).toBe(1.3)
    state = { ...state, reps: 5, interval: 300, ease: 3 }
    expect(schedule(state, 'easy', now).interval).toBe(365)
  })
})
