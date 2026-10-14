import { useEffect, useRef, useState } from 'react'
import type { ItemView } from '../shared/workspace-api.js'
import { formatTimestamp, startAt, YOUTUBE_ORIGIN, youtubeEmbedUrl, youtubeId } from './video.js'

/** Players on the desk, so starting one pauses the others: one audio source at a time. */
const players = new Map<string, { pause(): void }>()

function started(id: string): void {
  for (const [other, player] of players) if (other !== id) player.pause()
}

/** How long a player may take to answer before the sheet says so. */
const PATIENCE = 10_000

/** What a YouTube embed reports after "listening". */
interface YouTubeMessage {
  event?: string
  info?: { currentTime?: number; playerState?: number; videoData?: { title?: string } } | number | null
}

/**
 * A YouTube video playing on its sheet, without YouTube's script on the desk:
 * the embed speaks a small postMessage protocol. After "listening" it reports
 * the time and state; commands go back as {event: "command", func}.
 */
export function VideoView({
  sheet,
  item,
  onTime,
  onTitle,
}: {
  sheet: string
  item: ItemView & { url: string }
  onTime: (at: string) => void
  /** The player named the video. */
  onTitle: (title: string) => void
}) {
  const url = item.url
  const frame = useRef<HTMLIFrameElement>(null)
  const id = youtubeId(url) ?? ''
  const src = useRef(youtubeEmbedUrl(id, location.origin, startAt(url))).current
  const report = useRef(onTime)
  report.current = onTime
  const name = useRef(onTitle)
  name.current = onTitle
  // The player stays hidden until it answers, so a failed load shows the face, not an error page.
  const [state, setState] = useState<'loading' | 'ready' | 'silent'>('loading')

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const send = (message: object): void => element.contentWindow?.postMessage(JSON.stringify(message), YOUTUBE_ORIGIN)
    players.set(sheet, { pause: () => send({ event: 'command', func: 'pauseVideo', args: [] }) })
    // Like YouTube's own iframe API: keep saying "listening" until the player
    // answers, since its script may not be ready when the frame loads.
    let heard = false
    let hello: ReturnType<typeof setInterval> | undefined
    const listen = (): void => {
      clearInterval(hello)
      heard = false
      hello = setInterval(() => {
        if (heard) clearInterval(hello)
        else send({ event: 'listening', id: sheet, channel: 'widget' })
      }, 250)
    }
    element.addEventListener('load', listen)
    let shown = ''
    let named = false
    const receive = (event: MessageEvent): void => {
      if (event.source !== element.contentWindow || event.origin !== YOUTUBE_ORIGIN || typeof event.data !== 'string') return
      let data: YouTubeMessage
      try {
        data = JSON.parse(event.data) as YouTubeMessage
      } catch {
        return
      }
      if (!heard) setState('ready')
      heard = true
      const info = typeof data.info === 'object' && data.info !== null ? data.info : undefined
      if (info?.playerState === 1) started(sheet)
      const title = info?.videoData?.title
      if (title && !named) {
        named = true
        name.current(title)
      }
      if (typeof info?.currentTime === 'number') {
        const at = formatTimestamp(info.currentTime)
        if (at !== shown) report.current((shown = at))
      }
    }
    window.addEventListener('message', receive)
    const patience = setTimeout(() => setState((now) => (now === 'loading' ? 'silent' : now)), PATIENCE)
    return () => {
      clearTimeout(patience)
      clearInterval(hello)
      element.removeEventListener('load', listen)
      window.removeEventListener('message', receive)
      players.delete(sheet)
    }
  }, [sheet])

  return (
    <div className="video-view" data-player={state}>
      <div className="source-face">
        <h3>{item.title}</h3>
        <p className="source-url">{url}</p>
        <p>{state === 'silent' ? 'The player did not load. Check your connection, then reopen the desk.' : 'Loading the player…'}</p>
      </div>
      <iframe ref={frame} src={src} title="Video player" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
    </div>
  )
}
