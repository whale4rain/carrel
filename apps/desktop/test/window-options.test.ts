import { tokens } from '@carrel/margin'
import { describe, expect, it } from 'vitest'
import { WINDOWS_TITLE_HEIGHT, windowOptions } from '../src/main/window-options.js'

describe('windowOptions', () => {
  it('insets the traffic lights on Mac', () => {
    const options = windowOptions('darwin', '/p', 'day')
    expect(options.titleBarStyle).toBe('hiddenInset')
    expect(options.titleBarOverlay).toBeUndefined()
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

  it('keeps the renderer sandboxed', () => {
    const prefs = windowOptions('win32', '/p', 'day').webPreferences
    expect(prefs).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  })
})
