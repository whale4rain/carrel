import { describe, expect, it } from 'vitest'
import { accelerator, keyLabel, SHORTCUTS, shortcutLabel, withShortcut } from '../src/shared/shortcuts.js'

describe('shortcut labels', () => {
  it('read as each system writes them', () => {
    expect(shortcutLabel('mac', 'agent')).toBe('⌘J')
    expect(shortcutLabel('windows', 'agent')).toBe('Ctrl+J')
    expect(shortcutLabel('mac', 'focus')).toBe('⌘↩')
    expect(shortcutLabel('windows', 'focus')).toBe('Ctrl+Enter')
    expect(shortcutLabel('mac', 'zoom-out')).toBe('⌘−')
    expect(shortcutLabel('windows', 'zoom-in')).toBe('Ctrl++')
    expect(keyLabel('mac', { mod: true, shift: true, alt: true, key: 'k' })).toBe('⌥⇧⌘K')
    expect(keyLabel('windows', { mod: true, shift: true, alt: true, key: 'k' })).toBe('Ctrl+Alt+Shift+K')
  })

  it('use each system’s own keys where they differ', () => {
    expect(shortcutLabel('mac', 'redo')).toBe('⇧⌘Z')
    expect(shortcutLabel('windows', 'redo')).toBe('Ctrl+Y')
    expect(shortcutLabel('mac', 'remove')).toBe('⌫')
    expect(shortcutLabel('windows', 'remove')).toBe('Delete')
  })

  it('go after what a control does in its tooltip', () => {
    expect(withShortcut('windows', 'Zoom in', 'zoom-in')).toBe('Zoom in (Ctrl++)')
  })

  it('give the menu bar Electron accelerators', () => {
    expect(accelerator('that', 'darwin')).toBe('CommandOrControl+Period')
    expect(accelerator('redo', 'darwin')).toBe('CommandOrControl+Shift+Z')
    expect(accelerator('redo', 'win32')).toBe('CommandOrControl+Y')
    expect(accelerator('region', 'win32')).toBeUndefined()
  })

  it('have one id each', () => {
    const ids = SHORTCUTS.flatMap((group) => group.shortcuts.map((shortcut) => shortcut.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})
