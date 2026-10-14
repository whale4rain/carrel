import { describe, expect, it } from 'vitest'
import { windowOptions } from '../src/main/window-options.js'

describe('windowOptions', () => {
  it('insets the traffic lights on Mac only', () => {
    expect(windowOptions('darwin', '/p').titleBarStyle).toBe('hiddenInset')
    expect(windowOptions('win32', '/p').titleBarStyle).toBeUndefined()
  })

  it('keeps the renderer sandboxed', () => {
    const prefs = windowOptions('win32', '/p').webPreferences
    expect(prefs).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  })
})
