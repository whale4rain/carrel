import { describe, expect, it } from 'vitest'
import { linkIn, sourceLine } from '../src/renderer/sources.js'

describe('sources', () => {
  it('describes a source in one line', () => {
    expect(sourceLine({ id: 'a', kind: 'paper', title: 'x', file: { name: 'x.pdf', size: 1_300_000 } })).toBe('PDF · 1.2 MB')
    expect(sourceLine({ id: 'b', kind: 'video', title: 'y', url: 'https://www.youtube.com/watch?v=1' })).toBe('youtube.com')
  })

  it('finds a link in pasted text', () => {
    expect(linkIn(' https://example.com/a ')).toBe('https://example.com/a')
    expect(linkIn('see https://example.com')).toBeUndefined()
    expect(linkIn('javascript:alert(1)')).toBeUndefined()
  })
})
