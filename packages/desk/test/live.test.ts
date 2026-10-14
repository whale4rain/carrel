import { describe, expect, it } from 'vitest'
import { pickLive, type LiveSheet, type LiveState } from '../src/index.js'

const web = (id: string, x: number, z: number): LiveSheet => ({
  id,
  web: true,
  box: { x, y: 100, w: 400, h: 300 },
  page: { x, y: 136, w: 400, h: 264 },
  z,
})

const state = (over: Partial<LiveState> = {}): LiveState => ({
  sheets: [web('a', 100, 1), web('b', 600, 2)],
  active: 'a',
  moving: false,
  desk: { x: 0, y: 0, w: 1200, h: 800 },
  overlays: [],
  ...over,
})

describe('pickLive', () => {
  it('makes the active web sheet live', () => {
    expect(pickLive(state())).toEqual({ live: 'a' })
  })

  it('needs an active web sheet', () => {
    expect(pickLive(state({ active: undefined }))).toEqual({ live: undefined, reason: 'none-active' })
    expect(pickLive(state({ sheets: [{ ...web('a', 100, 1), web: false }] }))).toEqual({ live: undefined, reason: 'not-web' })
  })

  it('waits while anything moves', () => {
    expect(pickLive(state({ moving: true }))).toEqual({ live: undefined, reason: 'moving' })
  })

  it('needs the whole page on the desk', () => {
    expect(pickLive(state({ desk: { x: 0, y: 0, w: 450, h: 800 } }))).toEqual({ live: undefined, reason: 'off-desk' })
  })

  it('gives way to a sheet above it, but not below it', () => {
    expect(pickLive(state({ sheets: [web('a', 100, 1), web('b', 300, 2)] }))).toEqual({ live: undefined, reason: 'covered' })
    expect(pickLive(state({ sheets: [web('a', 100, 3), web('b', 300, 2)] }))).toEqual({ live: 'a' })
  })

  it('gives way to menus and bars drawn over the desk', () => {
    expect(pickLive(state({ overlays: [{ x: 450, y: 380, w: 100, h: 40 }] }))).toEqual({ live: undefined, reason: 'covered' })
  })
})
