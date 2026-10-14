import { makeVideoThat, othersToPause, youtubeEmbedUrl, youtubeId, type VideoThat } from '../src/video.ts'

interface Capture { dataUrl: string; size: { width: number; height: number }; spread: number; ms: number }
interface Bridge { capture(rect: DOMRect | { x: number; y: number; width: number; height: number }): Promise<Capture> }
const bridge = (window as unknown as { bridge: Bridge }).bridge

/** The two calls Carrel needs from any player, whatever the site. */
interface Player {
  time(): number
  play(): void
  pause(): void
  readonly element: HTMLElement
  /** What the player reported, for the check's diagnostics. */
  debug?(): object
}

const playing = new Set<string>()

function html5Player(id: string, src: string): Player {
  const video = document.createElement('video')
  video.className = 'player'
  video.src = src
  video.controls = true
  video.addEventListener('play', () => started(id))
  video.addEventListener('pause', () => playing.delete(id))
  return {
    element: video,
    time: () => video.currentTime,
    play: () => void video.play(),
    pause: () => video.pause(),
  }
}

/**
 * YouTube without its script: the embed speaks a small postMessage protocol.
 * After "listening", it sends infoDelivery messages with currentTime and
 * playerState; commands go back as {event: "command", func}.
 */
function youtubePlayer(id: string, videoId: string): Player {
  const frame = document.createElement('iframe')
  frame.className = 'player'
  frame.allow = 'autoplay; encrypted-media; picture-in-picture'
  frame.src = youtubeEmbedUrl(videoId, location.origin)
  let current = 0
  let reportedAt = performance.now()
  let state = -1
  const send = (message: object): void => frame.contentWindow?.postMessage(JSON.stringify(message), 'https://www.youtube-nocookie.com')
  // Like YouTube's own iframe API: keep saying "listening" until the player
  // answers, since its script may not be ready when the frame's load fires.
  let heard = 0
  const events: string[] = []
  let lastError: unknown
  let hello: ReturnType<typeof setInterval> | undefined
  frame.addEventListener('load', () => {
    clearInterval(hello)
    hello = setInterval(() => {
      if (heard) clearInterval(hello)
      else send({ event: 'listening', id, channel: 'widget' })
    }, 250)
  })
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow || typeof event.data !== 'string') return
    let data: { event?: string; info?: { currentTime?: number; playerState?: number } | number }
    try {
      data = JSON.parse(event.data) as typeof data
    } catch {
      return
    }
    heard++
    if (data.event && events.at(-1) !== data.event) events.push(data.event)
    if (data.event === 'onReady') send({ event: 'command', func: 'playVideo', args: [] })
    if (data.event === 'onError') lastError = data.info
    const info = typeof data.info === 'object' ? data.info : undefined
    if (!info) return
    if (typeof info.currentTime === 'number') {
      current = info.currentTime
      reportedAt = performance.now()
    }
    if (typeof info.playerState === 'number') {
      state = info.playerState
      if (state === 1) started(id)
      else playing.delete(id)
    }
  })
  return {
    element: frame,
    // Reports arrive a few times a second; extrapolate between them while playing.
    time: () => (state === 1 ? current + (performance.now() - reportedAt) / 1000 : current),
    play: () => send({ event: 'command', func: 'playVideo', args: [] }),
    pause: () => send({ event: 'command', func: 'pauseVideo', args: [] }),
    debug: () => ({ messages: heard, events: events.slice(0, 12), state, lastError }),
  }
}

function started(id: string): void {
  for (const other of othersToPause(new Set([...playing, id]), id)) players.get(other)?.pause()
  playing.clear()
  playing.add(id)
}

// ---- Desk -----------------------------------------------------------------

interface SheetModel { id: string; title: string; x: number; y: number; scale: number; z: number }
const deskElement = document.getElementById('desk') as HTMLElement
const shelf = document.getElementById('shelf') as HTMLElement
const players = new Map<string, Player>()
const sheets = new Map<string, { model: SheetModel; element: HTMLElement }>()

function addSheet(model: SheetModel, player: Player): void {
  const element = document.createElement('div')
  element.className = 'sheet'
  element.innerHTML = `<div class="head"><span class="title"></span><span class="time">0:00</span><button data-scale="-">−</button><button data-scale="+">+</button><button class="that">that.</button></div>`
  ;(element.querySelector('.title') as HTMLElement).textContent = model.title
  element.append(player.element)
  deskElement.append(element)
  players.set(model.id, player)
  sheets.set(model.id, { model, element })
  for (const button of element.querySelectorAll<HTMLButtonElement>('button[data-scale]')) {
    button.addEventListener('click', () => spike.scale(model.id, model.scale + (button.dataset.scale === '+' ? 0.1 : -0.1)))
  }
  ;(element.querySelector('.that') as HTMLElement).addEventListener('click', () => void spike.that(model.id))
  const head = element.querySelector('.head') as HTMLElement
  head.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement).tagName === 'BUTTON') return
    const start = { x: event.clientX, y: event.clientY, left: model.x, top: model.y }
    head.setPointerCapture(event.pointerId)
    model.z = nextZ()
    const move = (next: PointerEvent): void => spike.place(model.id, start.left + next.clientX - start.x, start.top + next.clientY - start.y)
    head.addEventListener('pointermove', move)
    head.addEventListener('pointerup', () => head.removeEventListener('pointermove', move), { once: true })
  })
  render(model.id)
}

let z = 1
const nextZ = (): number => ++z

function render(id: string): void {
  const sheet = sheets.get(id)
  if (!sheet) return
  const { model, element } = sheet
  element.style.left = `${model.x}px`
  element.style.top = `${model.y}px`
  element.style.transform = `scale(${model.scale})`
  element.style.zIndex = String(model.z)
}

setInterval(() => {
  for (const [id, sheet] of sheets) {
    const label = makeVideoThat(id, players.get(id)?.time() ?? 0).label
    ;(sheet.element.querySelector('.time') as HTMLElement).textContent = label
  }
}, 250)

function addChip(sheetTitle: string, that: VideoThat, capture: Capture): void {
  if (shelf.querySelector('span')) shelf.innerHTML = ''
  const chip = document.createElement('div')
  chip.className = 'chip'
  chip.innerHTML = `<img alt="" /><div><em>that.</em> <span class="pos"></span><br /><span class="src"></span></div>`
  ;(chip.querySelector('img') as HTMLImageElement).src = capture.dataUrl
  ;(chip.querySelector('.pos') as HTMLElement).textContent = that.label
  ;(chip.querySelector('.src') as HTMLElement).textContent = sheetTitle
  shelf.append(chip)
}

/** Driven by the scripted check, and usable from DevTools. */
const spike = {
  ready: (): Promise<void> => Promise.all([...players.values()].map((player) =>
    player.element instanceof HTMLVideoElement && player.element.readyState < 2
      ? new Promise<void>((resolve) => player.element.addEventListener('canplay', () => resolve(), { once: true }))
      : Promise.resolve(),
  )).then(() => undefined),
  play: (id: string): void => players.get(id)?.play(),
  time: (id: string): number => players.get(id)?.time() ?? -1,
  debug: (id: string): object | undefined => players.get(id)?.debug?.(),
  playing: (): string[] => [...playing],
  place(id: string, x: number, y: number): void {
    const sheet = sheets.get(id)
    if (!sheet) return
    sheet.model.x = x
    sheet.model.y = y
    sheet.model.z = nextZ()
    render(id)
  },
  scale(id: string, scale: number): void {
    const sheet = sheets.get(id)
    if (!sheet) return
    sheet.model.scale = Math.round(Math.min(1, Math.max(0.3, scale)) * 10) / 10
    render(id)
  },
  async that(id: string): Promise<{ time: number; that: VideoThat; capture: Capture }> {
    const player = players.get(id)
    const sheet = sheets.get(id)
    if (!player || !sheet) throw new Error(`no video ${id}`)
    const time = player.time()
    const rect = player.element.getBoundingClientRect()
    const capture = await bridge.capture({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    const that = makeVideoThat(id, time)
    addChip(sheet.model.title, that, capture)
    return { time, that, capture }
  },
  async frameHash(id: string): Promise<string> {
    const rect = players.get(id)?.element.getBoundingClientRect()
    if (!rect) return ''
    const capture = await bridge.capture({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    return capture.dataUrl.slice(-400)
  },
}
;(window as unknown as { spike: typeof spike }).spike = spike

addSheet({ id: 'lecture', title: 'Lecture 4 · Elasticity', x: 40, y: 30, scale: 1, z: 1 }, html5Player('lecture', '/media/lecture.webm'))
addSheet({ id: 'seminar', title: 'Seminar recording', x: 600, y: 30, scale: 0.7, z: 1 }, html5Player('seminar', '/media/seminar.webm'))

function addYoutube(url: string): void {
  const id = youtubeId(url) ?? (/^[\w-]{11}$/.test(url) ? url : undefined)
  if (!id || sheets.has('youtube')) return
  addSheet({ id: 'youtube', title: 'YouTube', x: 640, y: 260, scale: 0.8, z: nextZ() }, youtubePlayer('youtube', id))
}
const requested = new URLSearchParams(location.search).get('youtube')
if (requested) addYoutube(requested)
const input = document.getElementById('yt') as HTMLInputElement
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addYoutube(input.value.trim())
})
