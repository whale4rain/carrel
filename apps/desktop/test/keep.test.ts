import { describe, expect, it } from 'vitest'
import { captureFor, offerOf, type Gathered } from '../src/main/keep.js'

const gathered: Gathered = {
  page: { url: 'https://example.com/prefix', title: 'How prefix caching works', text: 'Servers keep KV blocks.' },
  selection: ' keep KV blocks ',
  copied: 'keep KV blocks',
  screen: new Uint8Array([1, 2, 3]),
}

describe('Keep', () => {
  it('offers what was found, without repeating the selection as copied text', () => {
    expect(offerOf(gathered, 'data:image/png;base64,AA')).toEqual({ page: { url: 'https://example.com/prefix', title: 'How prefix caching works' }, selection: 'keep KV blocks', screenshot: 'data:image/png;base64,AA' })
    expect(offerOf({ copied: '   ' })).toEqual({})
  })

  it('keeps the page, the selection with its page, copied words or the screen, with your reason', () => {
    expect(captureFor('page', gathered, ' for the notes ')).toEqual({ kind: 'page', from: 'keep', title: 'How prefix caching works', text: 'Servers keep KV blocks.', url: 'https://example.com/prefix', reason: 'for the notes' })
    expect(captureFor('selection', gathered, '')).toEqual({ kind: 'selection', from: 'keep', title: 'How prefix caching works', text: 'keep KV blocks', url: 'https://example.com/prefix' })
    expect(captureFor('copied', { copied: 'A long thought' }, '')).toMatchObject({ kind: 'selection', title: 'A long thought', text: 'A long thought' })
    expect(captureFor('screenshot', gathered, '', 'shot.png', new Date(2026, 9, 28, 10, 40))).toEqual({ kind: 'screenshot', from: 'keep', title: 'Screenshot at 10:40', text: '', image: 'shot.png' })
    expect(() => captureFor('page', {}, '')).toThrow(/not there/)
  })
})
