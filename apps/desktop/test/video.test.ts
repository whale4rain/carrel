import { describe, expect, it } from 'vitest'
import { asWebPage, embedded, formatTimestamp, startAt, youtubeEmbedUrl, youtubeId } from '../src/renderer/video.js'

const video = (url: string) => ({ id: 'i', kind: 'video' as const, title: 't', url })

describe('videos', () => {
  it('finds the YouTube id in the usual links', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=30')).toBe('aqz-KE-bpKQ')
    expect(youtubeId('https://youtu.be/aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ')
    expect(youtubeId('https://m.youtube.com/shorts/aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ')
    expect(youtubeId('https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ')).toBe('aqz-KE-bpKQ')
    expect(youtubeId('https://www.youtube.com/@channel')).toBeUndefined()
    expect(youtubeId('https://vimeo.com/76979871')).toBeUndefined()
  })

  it('reads where a link starts', () => {
    expect(startAt('https://youtu.be/aqz-KE-bpKQ?t=90')).toBe(90)
    expect(startAt('https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=1h2m5s')).toBe(3725)
    expect(startAt('https://youtu.be/aqz-KE-bpKQ')).toBe(0)
  })

  it('embeds without autoplay, talking only to the desk', () => {
    const url = new URL(youtubeEmbedUrl('aqz-KE-bpKQ', 'https://desk.carrel.app', 90))
    expect(url.origin).toBe('https://www.youtube-nocookie.com')
    expect(url.searchParams.get('origin')).toBe('https://desk.carrel.app')
    expect(url.searchParams.get('enablejsapi')).toBe('1')
    expect(url.searchParams.get('start')).toBe('90')
    expect(url.searchParams.has('autoplay')).toBe(false)
  })

  it('plays YouTube on the sheet and opens other videos as web pages', () => {
    expect(embedded(video('https://youtu.be/aqz-KE-bpKQ'))).toBe(true)
    expect(asWebPage(video('https://youtu.be/aqz-KE-bpKQ'))).toBe(false)
    expect(asWebPage(video('https://vimeo.com/76979871'))).toBe(true)
    expect(asWebPage({ id: 'p', kind: 'web_page', title: 'p', url: 'https://example.com' })).toBe(true)
  })

  it('writes times like a player', () => {
    expect(formatTimestamp(0)).toBe('0:00')
    expect(formatTimestamp(75.9)).toBe('1:15')
    expect(formatTimestamp(3725)).toBe('1:02:05')
  })
})
