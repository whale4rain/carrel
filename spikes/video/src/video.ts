// Pure helpers for video on the desk, tested without Electron.

/** A *that.* on a video moment, as a W3C Web Annotation selector plus a frame. */
export interface VideoThat {
  sourceId: string
  selector: { type: 'FragmentSelector'; conformsTo: 'http://www.w3.org/TR/media-frags/'; value: string }
  /** Where it shows in the UI, e.g. "12:34". */
  label: string
}

/** One decimal place is plenty for pointing at a moment. */
export function makeVideoThat(sourceId: string, seconds: number): VideoThat {
  const t = Math.max(0, Math.round(seconds * 10) / 10)
  return {
    sourceId,
    selector: { type: 'FragmentSelector', conformsTo: 'http://www.w3.org/TR/media-frags/', value: `t=${t}` },
    label: formatTimestamp(t),
  }
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatTimestamp(seconds: number): string {
  const whole = Math.floor(Math.max(0, seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = String(whole % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** The YouTube video id from the usual URL shapes, or undefined. */
export function youtubeId(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  const host = parsed.hostname.replace(/^www\./, '').replace(/^m\./, '')
  const id =
    host === 'youtu.be'
      ? parsed.pathname.slice(1)
      : host === 'youtube.com' || host === 'youtube-nocookie.com'
        ? parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/shorts/')
          ? parsed.pathname.split('/')[2]
          : (parsed.searchParams.get('v') ?? undefined)
        : undefined
  return id && /^[\w-]{11}$/.test(id) ? id : undefined
}

/** The embed URL Carrel loads: privacy-enhanced host, JS API on, starts muted. */
export function youtubeEmbedUrl(id: string, origin: string): string {
  const params = new URLSearchParams({ enablejsapi: '1', mute: '1', autoplay: '1', playsinline: '1', origin })
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`
}

/** One audio source at a time: when `started` plays, these others must pause. */
export function othersToPause(playing: ReadonlySet<string>, started: string): string[] {
  return [...playing].filter((id) => id !== started)
}

/**
 * Whether a captured frame shows something: the spread of pixel brightness.
 * A blank or black capture has almost none.
 */
export function brightnessSpread(bitmap: Uint8Array, step = 16): number {
  let min = 255
  let max = 0
  for (let i = 0; i + 2 < bitmap.length; i += 4 * step) {
    const value = ((bitmap[i] ?? 0) + (bitmap[i + 1] ?? 0) + (bitmap[i + 2] ?? 0)) / 3
    if (value < min) min = value
    if (value > max) max = value
  }
  return max - min
}
