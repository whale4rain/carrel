import { describe, expect, it } from 'vitest'
import { frameFor, shortcut } from '../src/shared/frame.js'

describe('frameFor', () => {
  it('follows the platform', () => {
    expect(frameFor('darwin')).toBe('mac')
    expect(frameFor('win32')).toBe('windows')
    expect(frameFor('linux')).toBe('plain')
  })

  it('takes a valid override, for screenshots', () => {
    expect(frameFor('linux', 'windows')).toBe('windows')
    expect(frameFor('darwin', 'nonsense')).toBe('mac')
  })
})

describe('shortcut', () => {
  it('reads as each platform writes it', () => {
    expect(shortcut('mac', 'J')).toBe('⌘J')
    expect(shortcut('windows', 'J')).toBe('Ctrl+J')
  })
})
