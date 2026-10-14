import { describe, expect, it } from 'vitest'
import { fitView, MAX_ZOOM, MIN_ZOOM, toDesk, toScreen, visibleRect, zoomAt, zoomStep } from '../src/index.js'

describe('view', () => {
  const view = { x: 100, y: 50, zoom: 0.5 }

  it('maps between desk and screen', () => {
    expect(toScreen(view, { x: 200, y: 100 })).toEqual({ x: 200, y: 100 })
    expect(toDesk(view, { x: 200, y: 100 })).toEqual({ x: 200, y: 100 })
    expect(toDesk(view, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 })
  })

  it('zooms around the pointer', () => {
    const zoomed = zoomAt(view, { x: 300, y: 300 }, 1)
    expect(zoomed.zoom).toBe(1)
    expect(toScreen(zoomed, toDesk(view, { x: 300, y: 300 }))).toEqual({ x: 300, y: 300 })
  })

  it('keeps zoom in range', () => {
    expect(zoomAt(view, { x: 0, y: 0 }, 9).zoom).toBe(MAX_ZOOM)
    expect(zoomAt(view, { x: 0, y: 0 }, 0.01).zoom).toBe(MIN_ZOOM)
  })

  it('steps, stopping at 100% on the way through', () => {
    expect(zoomStep(1, 1)).toBe(1.25)
    expect(zoomStep(0.9, 1)).toBe(1)
    expect(zoomStep(1.1, -1)).toBe(1)
    expect(zoomStep(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('knows what a screen shows', () => {
    expect(visibleRect(view, 800, 600)).toEqual({ x: -200, y: -100, w: 1600, h: 1200 })
  })

  it('fits a region, never above 100%', () => {
    const fitted = fitView({ x: 0, y: 0, w: 2000, h: 1000 }, 1096, 600)
    expect(fitted.zoom).toBe(0.5)
    expect(toScreen(fitted, { x: 1000, y: 500 })).toEqual({ x: 548, y: 300 })
    expect(fitView({ x: 0, y: 0, w: 100, h: 100 }, 1000, 1000).zoom).toBe(1)
  })
})
