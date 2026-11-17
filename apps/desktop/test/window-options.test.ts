import { tokens } from '@carrel/margin'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MAC_TRAFFIC_LIGHTS, WINDOWS_TITLE_HEIGHT, windowOptions } from '../src/main/window-options.js'

describe('windowOptions', () => {
  it('insets the traffic lights on Mac', () => {
    const options = windowOptions('darwin', '/p', 'day')
    expect(options.titleBarStyle).toBe('hiddenInset')
    expect(options.titleBarOverlay).toBeUndefined()
    expect(options.trafficLightPosition).toEqual(MAC_TRAFFIC_LIGHTS)
  })

  it('keeps the Mac traffic lights inside the rail and centered in the top bar', () => {
    const css = readFileSync(new URL('../src/renderer/shell.css', import.meta.url), 'utf8')
    const mac = /\.shell\[data-frame='mac'\] \{[^}]*--rail-width: (\d+)px/.exec(css)
    const top = /\.shell\[data-frame='mac'\] \{[^}]*--topbar-height: (\d+)px/.exec(css)
    const rail = Number(mac?.[1])
    // Three 12px lights, 8px apart, centered over the rail.
    const lights = 3 * 12 + 2 * 8
    expect(MAC_TRAFFIC_LIGHTS.x + lights).toBeLessThanOrEqual(rail - MAC_TRAFFIC_LIGHTS.x)
    // Centered in the top bar, so the rail's places start below them.
    expect(MAC_TRAFFIC_LIGHTS.y * 2 + 12).toBe(Number(top?.[1]))
  })

  it('draws its own title strip on Windows, with native caption buttons in the theme', () => {
    const night = windowOptions('win32', '/p', 'night')
    expect(night.titleBarStyle).toBe('hidden')
    expect(night.titleBarOverlay).toEqual({
      color: tokens.colors['paper-2'].night,
      symbolColor: tokens.colors.ink.night,
      height: WINDOWS_TITLE_HEIGHT,
    })
  })

  it('keeps the system frame elsewhere', () => {
    expect(windowOptions('linux', '/p', 'day').titleBarStyle).toBeUndefined()
  })

  it('opens on the mat color, so there is no white flash', () => {
    expect(windowOptions('darwin', '/p', 'night').backgroundColor).toBe(tokens.colors.mat.night)
  })

  it('gives Windows its .ico and Linux a PNG; Mac takes the bundle icon', () => {
    expect(windowOptions('win32', '/p', 'day', '/icons').icon).toBe(join('/icons', 'icon.ico'))
    expect(windowOptions('linux', '/p', 'day', '/icons').icon).toBe(join('/icons', 'icon.png'))
    expect(windowOptions('darwin', '/p', 'day', '/icons').icon).toBeUndefined()
  })

  it('keeps the renderer sandboxed', () => {
    const prefs = windowOptions('win32', '/p', 'day').webPreferences
    expect(prefs).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  })
})
