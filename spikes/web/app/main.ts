// Live web on the desk: one WebContentsView placed over a DOM sheet, swapped
// for a capturePage() snapshot whenever it can't be live.
import { app, BrowserWindow, ipcMain, WebContentsView, type NativeImage } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { pickLive, viewBounds, type DeskState, type LiveDecision } from '../src/live-policy.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const pages = join(here, '..', 'pages')
const HEADER = 28
const check = process.env.CARREL_SPIKE_CHECK === '1'
const realPages = process.env.CARREL_SPIKE_REAL === '1'

if (process.env.HTTPS_PROXY && realPages) app.commandLine.appendSwitch('proxy-server', process.env.HTTPS_PROXY)

/** The web sheets on the desk and what they load. */
const WEB_SHEETS: Record<string, string> = realPages
  ? {
      textbook: 'https://en.wikipedia.org/wiki/Price_elasticity_of_demand',
      lecture: 'https://en.wikipedia.org/wiki/Total_revenue_test',
    }
  : {
      textbook: pathToFileURL(join(pages, 'textbook.html')).href,
      lecture: pathToFileURL(join(pages, 'lecture.html')).href,
    }

interface Layout {
  state: DeskState
  deskOrigin: { x: number; y: number }
}

interface WebSheet {
  view: WebContentsView
  snapshot: NativeImage | undefined
  loaded: Promise<void>
}

/** Timings the check prints, in milliseconds. */
const timings = { capture: [] as number[], toSnapshot: [] as number[], toLive: [] as number[] }

let window: BrowserWindow
const sheets = new Map<string, WebSheet>()
let live: string | undefined
let lastDecision: LiveDecision = { live: undefined, reason: 'no-active-sheet' }
let lastLayout: Layout | undefined
let refreshTimer: ReturnType<typeof setInterval> | undefined

async function capture(id: string): Promise<void> {
  const sheet = sheets.get(id)
  if (!sheet) return
  const started = performance.now()
  // A view that has never been on screen has no surface and the capture rejects.
  const image = await sheet.view.webContents.capturePage().catch(() => undefined)
  if (!image || image.isEmpty()) return
  timings.capture.push(performance.now() - started)
  sheet.snapshot = image
  window.webContents.send('desk:snapshot', { id, dataUrl: image.toDataURL() })
}

/** Keeps the live sheet's snapshot fresh, so going inactive never waits on a capture. */
function startRefreshing(id: string): void {
  stopRefreshing()
  refreshTimer = setInterval(() => void capture(id), 1000)
}

function stopRefreshing(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = undefined
}

let primed: Promise<void> | undefined

/**
 * A view that was never shown can't be captured, so each web sheet is shown
 * once in its own place for a moment to take its first snapshot. In the app,
 * snapshots saved from the last session make this unnecessary on restart.
 */
async function prime(layout: Layout): Promise<void> {
  await Promise.all([...sheets.values()].map((sheet) => sheet.loaded))
  for (const [id, sheet] of sheets) {
    const layoutSheet = layout.state.sheets.find((entry) => entry.id === id)
    if (!layoutSheet || sheet.snapshot) continue
    sheet.view.setBounds(viewBounds(layoutSheet, HEADER, layout.deskOrigin))
    sheet.view.webContents.setZoomFactor(layoutSheet.scale)
    sheet.view.setVisible(true)
    // A busy runner can take a while to give the view a surface; try again until it has one.
    for (let tries = 0; tries < 25 && !sheet.snapshot; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 80))
      await capture(id)
    }
    if (live !== id) sheet.view.setVisible(false)
  }
}

async function apply(layout: Layout): Promise<void> {
  lastLayout = layout
  primed ??= prime(layout)
  const decision = pickLive(layout.state, HEADER)
  lastDecision = decision
  const started = performance.now()

  if (live && live !== decision.live) {
    // Going inactive: a capture of a visible view usually takes a few
    // milliseconds, so take a fresh one (scroll position and all) and only
    // then hide the view. A drag can't wait for that (Mac CI runners took up
    // to 370 ms): the view would trail the sheet, so it hides at once and the
    // last 1 s refresh stands in.
    const leaving = sheets.get(live)
    if (decision.reason !== 'moving') await capture(live)
    window.webContents.send('desk:live', { id: undefined, previous: live, reason: decision.reason })
    leaving?.view.setVisible(false)
    stopRefreshing()
    timings.toSnapshot.push(performance.now() - started)
    live = undefined
  }

  if (decision.live) {
    const sheet = sheets.get(decision.live)
    const layoutSheet = layout.state.sheets.find((entry) => entry.id === decision.live)
    if (!sheet || !layoutSheet) return
    sheet.view.setBounds(viewBounds(layoutSheet, HEADER, layout.deskOrigin))
    sheet.view.webContents.setZoomFactor(layoutSheet.scale)
    if (live !== decision.live) {
      sheet.view.setVisible(true)
      live = decision.live
      window.webContents.send('desk:live', { id: live, reason: decision.reason })
      timings.toLive.push(performance.now() - started)
      startRefreshing(live)
      const id = live
      setTimeout(() => void capture(id), 150)
    }
  }
}

async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'Carrel · live web spike',
    backgroundColor: '#efece4',
    webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true },
  })
  for (const [id, url] of Object.entries(WEB_SHEETS)) {
    const view = new WebContentsView({ webPreferences: { sandbox: true } })
    view.setVisible(false)
    window.contentView.addChildView(view)
    const loaded = view.webContents.loadURL(url)
    sheets.set(id, { view, snapshot: undefined, loaded })
  }
  await window.loadFile(join(here, 'index.html'))
  window.show()
  if (check) await runCheck()
}

// Layouts apply in order; the newest one waiting replaces older ones.
let applying: Promise<void> = Promise.resolve()
let next: Layout | undefined
let received = 0
ipcMain.on('desk:layout', (_event, layout: Layout) => {
  received += 1
  const queued = next !== undefined
  next = layout
  if (queued) return
  applying = applying.then(async () => {
    const latest = next
    next = undefined
    if (latest) await apply(latest)
  })
})

// ---- Scripted check -------------------------------------------------------

async function drive(script: string): Promise<void> {
  const before = received
  await window.webContents.executeJavaScript(script)
  // Wait for the layout to arrive over IPC (a fixed delay was too short on
  // busy Mac runners), then for every queued apply, since captures are slow
  // on some runners.
  const deadline = Date.now() + 3000
  while (received === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20))
  await new Promise((resolve) => setTimeout(resolve, 50))
  while (next !== undefined) await new Promise((resolve) => setTimeout(resolve, 20))
  await applying
}

async function runCheck(): Promise<void> {
  const failures: string[] = []
  const expect = (label: string, ok: boolean): void => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` (live: ${live ?? 'none'}, ${lastDecision.reason})`}`)
    if (!ok) failures.push(label)
  }
  const shots = process.env.CARREL_SPIKE_SHOTS
  const shot = async (name: string): Promise<void> => {
    if (!shots) return
    // Saved by an outside screen grabber (the window capture leaves native views out).
    console.log(`SHOT ${name}`)
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
  await Promise.all([...sheets.values()].map((sheet) => sheet.loaded))
  while (!primed) await new Promise((resolve) => setTimeout(resolve, 50))
  await primed
  expect('every web sheet has a first snapshot', [...sheets.values()].every((sheet) => !!sheet.snapshot))

  await drive("desk.activate('textbook')")
  expect('the active web sheet is live', live === 'textbook')
  const bounds = sheets.get('textbook')?.view.getBounds()
  const layoutSheet = lastLayout?.state.sheets.find((sheet) => sheet.id === 'textbook')
  expect(
    'the view sits exactly over its sheet',
    !!bounds && !!layoutSheet && !!lastLayout &&
      JSON.stringify(bounds) === JSON.stringify(viewBounds(layoutSheet, HEADER, lastLayout.deskOrigin)),
  )
  await shot('1-live')

  await drive("desk.place('lecture', 340, 160)")
  expect('a sheet moved over it turns it into a snapshot', live === undefined && lastDecision.reason === 'covered')
  await shot('2-covered')

  await drive("desk.place('lecture', 400, 60); desk.scale('textbook', 0.6)")
  expect('scaled to 60% it is live again', live === 'textbook')
  expect('the page zooms to match', sheets.get('textbook')?.view.webContents.getZoomFactor() === 0.6)
  await shot('3-scaled')

  await drive('desk.setMoving(true)')
  expect('nothing is live while dragging', live === undefined)
  await drive('desk.setMoving(false)')
  expect('live again after the drag', live === 'textbook')

  await drive("desk.activate('lecture')")
  expect('activating the other web sheet moves the live view', live === 'lecture')
  expect('the first sheet keeps a snapshot', !!sheets.get('textbook')?.snapshot)
  await shot('4-switched')

  const summary = (values: number[]): string =>
    values.length ? `${Math.max(...values).toFixed(1)} ms max, ${(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)} ms avg` : 'n/a'
  const report = {
    platform: `${process.platform} ${process.arch}`,
    capture: summary(timings.capture),
    toSnapshot: summary(timings.toSnapshot),
    toLive: summary(timings.toLive),
  }
  console.log(`TIMINGS ${JSON.stringify(report)}`)
  if (process.env.CARREL_SPIKE_REPORT) await writeFile(process.env.CARREL_SPIKE_REPORT, JSON.stringify(report, null, 2))
  app.exit(failures.length ? 1 : 0)
}

app.whenReady().then(createWindow).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})

app.on('window-all-closed', () => app.quit())
