import { describe, expect, it } from 'vitest'
import { brightnessSpread, formatTimestamp, makeVideoThat, othersToPause, youtubeEmbedUrl, youtubeId } from '../src/video.ts'

describe('makeVideoThat', () => {
  it('points at a moment with a media fragment selector', () => {
    expect(makeVideoThat('lecture-4', 754.26)).toEqual({
      sourceId: 'lecture-4',
      selector: { type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/', value: 't=754.3' },
      label: '12:34',
    })
  })
})

describe('formatTimestamp', () => {
  it.each([
    [0, '0:00'],
    [75.9, '1:15'],
    [3725, '1:02:05'],
  ])('%d → %s', (seconds, label) => {
    expect(formatTimestamp(seconds)).toBe(label)
  })
})

describe('youtubeId', () => {
  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  ])('reads %s', (url) => {
    expect(youtubeId(url)).toBe('dQw4w9WgXcQ')
  })

  it.each(['https://vimeo.com/76979871', 'not a url', 'https://www.youtube.com/watch?v=short'])('rejects %s', (url) => {
    expect(youtubeId(url)).toBeUndefined()
  })

  it('builds a muted, API-enabled privacy-mode embed', () => {
    const url = new URL(youtubeEmbedUrl('dQw4w9WgXcQ', 'https://desk.carrel.app'))
    expect(url.hostname).toBe('www.youtube-nocookie.com')
    expect(url.searchParams.get('enablejsapi')).toBe('1')
    expect(url.searchParams.get('origin')).toBe('https://desk.carrel.app')
  })
})

describe('othersToPause', () => {
  it('keeps one audio source at a time', () => {
    expect(othersToPause(new Set(['a', 'b']), 'b')).toEqual(['a'])
  })
})

describe('brightnessSpread', () => {
  it('is zero for a flat image and large for a varied one', () => {
    expect(brightnessSpread(new Uint8Array(4 * 64).fill(255), 1)).toBe(0)
    const varied = new Uint8Array(4 * 64)
    for (let i = 0; i < 64; i++) varied.fill(i * 4, i * 4, i * 4 + 4)
    expect(brightnessSpread(varied, 1)).toBeGreaterThan(200)
  })
})
