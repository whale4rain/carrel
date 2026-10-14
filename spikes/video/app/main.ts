// Video on the desk: embedded players in scaled, dragged DOM sheets. Reads
// the current time for *that.* and captures the frame from the window.
import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { brightnessSpread } from '../src/video.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const media = join(here, '..', 'media')
const check = process.env.CARREL_SPIKE_CHECK === '1'

/**
 * The desk is served from a real-looking https origin. YouTube's embed
 * refuses pages without an http(s) origin and referrer (file:// gets an
 * error screen), and its postMessage API only talks to the origin it was
 * given. Only this host is intercepted; every other https request passes on.
 */
const DESK_HOST = 'desk.carrel.app'
export const DESK_ORIGIN = `https://${DESK_HOST}`

app.whenReady().then(async () => {
  protocol.handle('https', (request) => {
    const url = new URL(request.url)
    if (url.hostname !== DESK_HOST) return net.fetch(request, { bypassCustomProtocolHandlers: true })
    const path = url.pathname.startsWith('/media/') ? join(media, url.pathname.slice(7)) : join(here, url.pathname)
    return net.fetch(pathToFileURL(path).href, { headers: request.headers })
  })
  // Some embeds check the Referer as well as the origin parameter.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.youtube-nocookie.com/*', 'https://*.youtube.com/*'] },
    (details, callback) => {
      details.requestHeaders.Referer ??= `${DESK_ORIGIN}/`
      callback({ requestHeaders: details.requestHeaders })
    },
  )

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Carrel · video spike',
    backgroundColor: '#efece4',
    webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, autoplayPolicy: 'no-user-gesture-required' },
  })

  ipcMain.handle('video:capture', async (_event, rect: { x: number; y: number; width: number; height: number }) => {
    const started = performance.now()
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    }
    const image = await window.webContents.capturePage(bounds)
    return {
      dataUrl: image.toDataURL(),
      size: image.getSize(),
      spread: brightnessSpread(image.toBitmap()),
      ms: performance.now() - started,
    }
  })

  const youtube = process.env.CARREL_SPIKE_YOUTUBE
  await window.loadURL(`${DESK_ORIGIN}/index.html${youtube ? `?youtube=${encodeURIComponent(youtube)}` : ''}`)
  if (check) await runCheck(window, youtube)
}).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})

app.on('window-all-closed', () => app.quit())

// ---- Scripted check -------------------------------------------------------

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function runCheck(window: BrowserWindow, youtube: string | undefined): Promise<void> {
  const failures: string[] = []
  const results: Record<string, unknown> = { platform: `${process.platform} ${process.arch}` }
  const expect = (label: string, ok: boolean, detail?: unknown): void => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` (${JSON.stringify(detail)})`}`)
    if (!ok) failures.push(label)
  }
  const run = <T>(script: string): Promise<T> => window.webContents.executeJavaScript(script) as Promise<T>
  const shot = async (name: string): Promise<void> => {
    if (!process.env.CARREL_SPIKE_SHOTS) return
    console.log(`SHOT ${name}`)
    await wait(700)
  }

  await run('spike.ready()')
  await run("spike.play('lecture')")
  const t0 = await run<number>("spike.time('lecture')")
  await wait(1500)
  const t1 = await run<number>("spike.time('lecture')")
  expect('the local video plays and its time advances', t1 - t0 > 1, { t0, t1 })

  await run("spike.place('lecture', 380, 200); spike.scale('lecture', 0.6)")
  await wait(300)
  const scaled = await run<{ time: number; capture: { size: { width: number; height: number }; spread: number; ms: number }; that: { selector: { value: string } } }>(
    "spike.that('lecture')",
  )
  expect('time still reads after dragging and scaling to 60%', scaled.time > t1, scaled.time)
  expect('the that. carries a media fragment', /^t=\d+(\.\d)?$/.test(scaled.that.selector.value), scaled.that.selector.value)
  expect('the captured frame is not blank', scaled.capture.spread > 40, scaled.capture.spread)
  expect('the frame is the scaled size', Math.abs(scaled.capture.size.width - 480 * 0.6) <= 3, scaled.capture.size)
  results.captureMs = Math.round(scaled.capture.ms * 10) / 10
  await shot('1-scaled-that')

  const firstFrame = await run<string>("spike.frameHash('lecture')")
  await wait(1200)
  const secondFrame = await run<string>("spike.frameHash('lecture')")
  expect('later captures show later frames', firstFrame !== secondFrame)

  await run("spike.play('seminar')")
  await wait(300)
  const playing = await run<string[]>('spike.playing()')
  expect('starting a second video pauses the first', playing.length === 1 && playing[0] === 'seminar', playing)

  if (youtube) {
    // YouTube needs the network; report what happened rather than guess.
    let ytTime = 0
    for (let i = 0; i < 40 && ytTime < 2; i++) {
      await wait(500)
      ytTime = await run<number>("spike.time('youtube')")
    }
    results.youtubeTime = ytTime
    expect('YouTube: current time arrives over postMessage and advances', ytTime >= 2, ytTime)
    const yt = await run<{ capture: { spread: number }; that: { selector: { value: string } } }>("spike.that('youtube')")
    expect('YouTube: the captured frame is not blank', yt.capture.spread > 40, yt.capture.spread)
    await shot('2-youtube')
  }

  console.log(`RESULTS ${JSON.stringify(results)}`)
  app.exit(failures.length ? 1 : 0)
}
