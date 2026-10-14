import { carrelRoots, Workspace } from '@carrel/core'
import { isTheme, type Theme } from '@carrel/margin'
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { frameFor } from '../shared/frame.js'
import { DESK_ORIGIN, deskUrl, serveDesk } from './desk-origin.js'
import { ShellController } from './shell-state.js'
import { titleBarOverlay, windowOptions } from './window-options.js'
import { serveWorkspace } from './workspace-ipc.js'
import { WebViews, type WebLayout } from './web-views.js'

const outDir = fileURLToPath(new URL('.', import.meta.url))

// `CARREL_SMOKE` opens the window, checks it, and quits. CI uses it to prove
// the app starts on Mac and Windows: `create` makes a project and a desk,
// `reopen` checks a restart comes back to them, `1` only checks it renders.
const smoke = process.env.CARREL_SMOKE

// Carrel follows the system's light or dark mode. `CARREL_THEME=day|night`
// forces one, for screenshots and checks.
const forced = process.env.CARREL_THEME
if (forced && isTheme(forced)) nativeTheme.themeSource = forced === 'night' ? 'dark' : 'light'
const currentTheme = (): Theme => (nativeTheme.shouldUseDarkColors ? 'night' : 'day')

// `CARREL_HOME` puts ~/Carrel and ~/.carrel somewhere else (checks, screenshots).
const workspace = new Workspace(carrelRoots(process.env.CARREL_HOME ?? homedir()))
const controller = new ShellController(workspace)

// Each window's web pages, by its renderer.
const webViews = new Map<number, WebViews>()
ipcMain.on('web:layout', (event, layout: WebLayout) => {
  if (isWebLayout(layout)) void webViews.get(event.sender.id)?.layout(layout)
})

// A rectangle of the window as a PNG: a video's frame for its *that.*
ipcMain.handle('web:frame', async (event, rect: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || !isRect(rect)) throw new Error('That is not a part of the window.')
  const bounds = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.w)), height: Math.max(1, Math.round(rect.h)) }
  return (await window.webContents.capturePage(bounds)).toPNG()
})

function isRect(value: unknown): value is { x: number; y: number; w: number; h: number } {
  if (typeof value !== 'object' || value === null) return false
  const rect = value as Record<string, unknown>
  return [rect.x, rect.y, rect.w, rect.h].every((n) => typeof n === 'number' && Number.isFinite(n))
}

function isWebLayout(value: unknown): value is WebLayout {
  if (typeof value !== 'object' || value === null) return false
  const layout = value as Partial<WebLayout>
  return Array.isArray(layout.sheets) && Array.isArray(layout.overlays) && typeof layout.moving === 'boolean' && typeof layout.desk === 'object'
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow(windowOptions(process.platform, `${outDir}preload.cjs`, currentTheme()))
  window.once('ready-to-show', () => window.show())
  const id = window.webContents.id
  webViews.set(
    id,
    new WebViews(window, {
      saveSnapshot: (itemId, png) => controller.saveSnapshot(itemId, png),
      title: (itemId, title) => {
        void controller.pageTitle(itemId, title).then((item) => {
          if (item && !window.isDestroyed()) window.webContents.send('web:item', item)
        }, () => undefined)
      },
      that: (itemId, text) => {
        void controller.makeThat({ itemId, text }).then((that) => {
          if (!window.isDestroyed()) window.webContents.send('web:that', that)
        }, (error: unknown) => console.error('that.:', error))
      },
    }),
  )
  window.on('closed', () => webViews.delete(id))
  if (process.platform === 'win32') {
    // The native caption buttons don't follow CSS; recolor them with the theme.
    const recolor = (): void => window.setTitleBarOverlay(titleBarOverlay(currentTheme()))
    nativeTheme.on('updated', recolor)
    window.on('closed', () => nativeTheme.off('updated', recolor))
  }
  if (smoke) {
    // Show renderer errors in the CI log, so a blank page says why.
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') console.error(`renderer: ${message}`)
    })
  }
  // `CARREL_FRAME=mac|windows` draws another platform's frame, for screenshots.
  const frame = frameFor(process.platform, process.env.CARREL_FRAME)
  await window.loadURL(deskUrl(frame))
  if (smoke) await runSmoke(window, smoke, () => window.loadURL(deskUrl(frame)))
  // `CARREL_SHOT=file.png` saves the window's page and quits, for PR screenshots.
  const shot = process.env.CARREL_SHOT
  if (shot) {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await writeFile(shot, (await window.webContents.capturePage()).toPNG())
    app.exit(0)
  }
}

/** Where the smoke's sheet should end up: added at (48, 48), dragged by (100, 60), widened by 40. */
const MOVED = { x: 148, y: 108, w: 440 }
/** A web page the smoke adds by its link, and the title it gets. */
const LINK = process.env.CARREL_SMOKE_PAGE ?? 'https://example.com/elasticity'
const LINK_TITLE = 'Carrel test page'
/** A YouTube video the smoke adds; it only checks the player is embedded, not that it plays. */
const VIDEO_ID = 'aqz-KE-bpKQ'
const VIDEO = `https://www.youtube.com/watch?v=${VIDEO_ID}`
/** The text of the smoke's PDF, as its sheet's text layer has it. */
const PDF_TEXT = "document.querySelector('.sheet[data-kind=\"paper\"] .textLayer')?.textContent"
/** The word the smoke points at with that. */
const THAT_WORD = 'elasticity'
/** Then scaled to 60% from the selection bar. */
const SCALED = { w: 264 }

/**
 * Drives the desk with real mouse events: adds a sheet, drags it by its label
 * row, and widens it by its right handle. Returns what went wrong, if anything.
 */
async function deskInteractions(
  window: BrowserWindow,
  page: <T>(script: string) => Promise<T>,
  waitFor: (script: string) => Promise<boolean>,
): Promise<string | undefined> {
  // + Add, then Blank sheet.
  const addBlank = async (): Promise<void> => {
    await page("[...document.querySelectorAll('.desk-tools button')].find((b) => b.textContent === '+ Add')?.click()")
    await waitFor("document.querySelector('.add-menu') !== null")
    await page("[...document.querySelectorAll('.add-menu button')].find((b) => b.textContent === 'Blank sheet')?.click()")
  }
  await addBlank()
  if (!(await waitFor("document.querySelectorAll('.sheet').length === 1"))) return 'adding a sheet did nothing'
  const center = async (selector: string): Promise<{ x: number; y: number }> =>
    page(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const drag = async (from: { x: number; y: number }, dx: number, dy: number): Promise<void> => {
    const send = (type: 'mouseDown' | 'mouseMove' | 'mouseUp', x: number, y: number, held = false): void =>
      window.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: held ? ['leftbuttondown'] : [] })
    send('mouseMove', from.x, from.y)
    send('mouseDown', from.x, from.y)
    for (let step = 1; step <= 10; step++) {
      send('mouseMove', from.x + (dx * step) / 10, from.y + (dy * step) / 10, true)
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    send('mouseUp', from.x + dx, from.y + dy)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const style = "document.querySelector('.sheet').style"
  // Fonts load after the page (the desk is served through its https handler), and
  // they move the label row; measure where things are only once they have.
  await page('document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => resolve(true))))')
  await drag(await center('.sheet-label'), 100, 60)
  if (!(await waitFor(`${style}.left === '${MOVED.x}px' && ${style}.top === '${MOVED.y}px'`))) {
    return `dragging the label row left the sheet at ${String(await page(`${style}.cssText`))}`
  }
  await drag(await center('.handle-e'), 40, 0)
  if (!(await waitFor(`${style}.width === '${MOVED.w}px' && ${style}.left === '${MOVED.x}px'`))) {
    return `the right handle left the sheet at ${String(await page(`${style}.cssText`))}`
  }
  // What the screen shows must also be what was saved.
  const saved = await page<string>(
    'window.carrel.workspace.state().then((s) => window.carrel.workspace.desk(s.open.desk)).then((d) => JSON.stringify(d.sheets.map(({ x, y, w }) => ({ x, y, w }))))',
  )
  if (saved !== JSON.stringify([MOVED])) return `the desk shows the moved sheet but saved ${saved}`
  const key = async (keyCode: string, modifiers: Array<'shift' | 'meta' | 'control'> = []): Promise<void> => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const mod = process.platform === 'darwin' ? 'meta' : 'control'
  await key('Z', [mod])
  if (!(await waitFor(`${style}.width === '${MOVED.w - 40}px'`))) return `undo left the sheet at ${String(await page(`${style}.cssText`))}`
  await key('Z', [mod, 'shift'])
  if (!(await waitFor(`${style}.width === '${MOVED.w}px'`))) return `redo left the sheet at ${String(await page(`${style}.cssText`))}`
  // A second sheet, deleted, brought back, and deleted again: the desk keeps one.
  await addBlank()
  const count = (n: number): string => `document.querySelectorAll('.sheet').length === ${n}`
  if (!(await waitFor(count(2)))) return 'adding a second sheet did nothing'
  await key('Delete')
  if (!(await waitFor(count(1)))) return 'Delete did not remove the selected sheet'
  await key('Z', [mod])
  if (!(await waitFor(count(2)))) return 'undo did not bring the deleted sheet back'
  await key('Z', [mod, 'shift'])
  if (!(await waitFor(count(1)))) return 'redo did not delete the sheet again'
  // A marquee from the bare mat selects the sheet; the selection bar scales it.
  const mat = await page<{ x: number; y: number }>("(() => { const r = document.querySelector('.desk-mat').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) } })()")
  await drag({ x: mat.x + 20, y: mat.y + 20 }, 200, 150)
  if (!(await waitFor("document.querySelector('.selection-bar .selection-count')?.textContent === '1 selected'"))) return 'the marquee did not select the sheet'
  const press = (label: string): Promise<unknown> =>
    page(`[...document.querySelectorAll('.selection-bar button')].find((b) => b.textContent === '${label}')?.click()`)
  await press('Scale')
  await press('60%')
  if (!(await waitFor(`${style}.width === '${SCALED.w}px'`))) return `scaling left the sheet at ${String(await page(`${style}.cssText`))}`
  // Two sheets into a pile, then both steps undone.
  await addBlank()
  if (!(await waitFor(count(2)))) return 'adding a sheet for the pile did nothing'
  await key('A', [mod])
  await press('Make a pile')
  if (!(await waitFor("document.querySelector('.pile-label')?.textContent.startsWith('Pile · 2') === true"))) return 'Make a pile made no pile'
  await key('Z', [mod])
  if (!(await waitFor("document.querySelector('.pile-label') === null"))) return 'undo did not take the pile apart'
  await key('Z', [mod])
  if (!(await waitFor(count(1)))) return 'undo did not take the added sheet away'
  // Two overlapping sheets, tidied apart, then undone.
  await addBlank()
  if (!(await waitFor(count(2)))) return 'adding a sheet to tidy did nothing'
  const overlap = "(() => { const [a, b] = [...document.querySelectorAll('.sheet')].map((s) => s.getBoundingClientRect()); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom })()"
  if (!(await waitFor(`${overlap} === true`))) return 'the new sheet did not land on the first'
  await page("[...document.querySelectorAll('.desk-tools button')].find((b) => b.textContent === 'Tidy up')?.click()")
  if (!(await waitFor(`${overlap} === false`))) return 'Tidy up left sheets overlapping'
  await key('Z', [mod])
  await key('Z', [mod])
  if (!(await waitFor(count(1)))) return 'undo did not take back Tidy up and the added sheet'
  if (!(await waitFor(`${style}.left === '${MOVED.x}px' && ${style}.top === '${MOVED.y}px'`))) return `undoing Tidy up left the sheet at ${String(await page(`${style}.cssText`))}`
  // Zoom out one step; the view is saved with the desk a moment later.
  await key('-', [mod])
  if (!(await waitFor("document.querySelector('.zoom-level')?.textContent === '80%'"))) return 'zooming out did not change the zoom'
  if (!(await waitFor('window.carrel.workspace.state().then((s) => window.carrel.workspace.desk(s.open.desk)).then((d) => d.viewport.zoom === 0.8)'))) {
    return 'the zoom was not saved'
  }
  // A web page by its link, through + Add.
  const addLink = async (link: string): Promise<boolean> => {
    await page("[...document.querySelectorAll('.desk-tools button')].find((b) => b.textContent === '+ Add')?.click()")
    await waitFor("document.querySelector('.add-menu') !== null")
    await page("[...document.querySelectorAll('.add-menu button')].find((b) => b.textContent.startsWith('Web page'))?.click()")
    if (!(await waitFor("document.querySelector('.add-link input') !== null"))) return false
    await page(`(() => {
      const input = document.querySelector('.add-link input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${link}')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await page("document.querySelector('.add-link').requestSubmit()")
    return true
  }
  if (!(await addLink(LINK))) return 'the link field did not open'
  if (!(await waitFor(`document.querySelector('.sheet[data-kind="web_page"]') !== null`))) return 'adding a link made no web page sheet'
  // Clicking into it makes it live; the page names its sheet; Esc leaves a snapshot.
  const web = await center('.sheet[data-kind="web_page"] .web-page')
  window.webContents.sendInputEvent({ type: 'mouseDown', x: web.x, y: web.y, button: 'left', clickCount: 1 })
  window.webContents.sendInputEvent({ type: 'mouseUp', x: web.x, y: web.y, button: 'left', clickCount: 1 })
  if (!(await waitFor("document.querySelector('.web-page[data-live]') !== null"))) return 'clicking the web sheet did not make it live'
  if (!(await waitFor(`document.querySelector('.sheet[data-kind="web_page"]')?.getAttribute('aria-label') === '${LINK_TITLE}'`))) {
    return `the web sheet is called ${String(await page(`document.querySelector('.sheet[data-kind="web_page"]')?.getAttribute('aria-label')`))}`
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
  await key('Escape')
  if (!(await waitFor("document.querySelector('.web-page[data-live]') === null && document.querySelector('.web-page img') !== null"))) {
    return 'leaving the web page left no snapshot'
  }
  // A YouTube link plays in an embedded player, which needs the desk's https origin.
  if (!(await addLink(VIDEO))) return 'the link field did not open again'
  const embed = `(document.querySelector('.sheet[data-kind="video"] .video-view iframe')?.src ?? '')`
  if (!(await waitFor(`${embed}.startsWith('https://www.youtube-nocookie.com/embed/${VIDEO_ID}?')`))) {
    return `the video sheet has no player: ${String(await page(embed))}`
  }
  const origin = await page<string>("location.origin")
  if (origin !== DESK_ORIGIN || new URL(String(await page(embed))).searchParams.get('origin') !== DESK_ORIGIN) return `the desk is served from ${origin}`
  // A PDF through + Add (the smoke answers the file dialog); its page is drawn with selectable text.
  await page("[...document.querySelectorAll('.desk-tools button')].find((b) => b.textContent === '+ Add')?.click()")
  await waitFor("document.querySelector('.add-menu') !== null")
  await page("[...document.querySelectorAll('.add-menu button')].find((b) => b.textContent.startsWith('Book or paper'))?.click()")
  if (!(await waitFor(`${PDF_TEXT} === 'Price elasticity of demand'`))) return `the PDF's text layer says ${String(await page(PDF_TEXT))}`
  // that.: select a word on the PDF's page and press ⌘. (Ctrl+.); a chip lands on the tray.
  await page(`(() => {
    const layer = document.querySelector('.sheet[data-kind="paper"] .textLayer')
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf('${THAT_WORD}')
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + ${THAT_WORD.length})
      getSelection().removeAllRanges()
      getSelection().addRange(range)
      return
    }
  })()`)
  await key('.', [mod])
  if (!(await waitFor("document.querySelector('.that-tray .that-chip')?.textContent === 'p.1'"))) {
    return `pointing at the PDF made no chip: ${String(await page("document.querySelector('.desk-error')?.textContent ?? 'no message'"))}`
  }
  if (!(await waitFor(`window.carrel.workspace.thats().then((thats) => thats.length === 1 && thats[0].text === '${THAT_WORD}')`))) return 'the that. was not kept'
  return undefined
}

async function runSmoke(window: BrowserWindow, mode: string, reload: () => Promise<void>): Promise<void> {
  const page = <T>(script: string): Promise<T> => window.webContents.executeJavaScript(script) as Promise<T>
  const waitFor = async (script: string): Promise<boolean> => {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if ((await page<unknown>(script)) === true) return true
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return false
  }
  const fail = (message: string): void => {
    console.error(`carrel smoke: ${message}`)
    app.exit(1)
  }

  if (!(await waitFor("document.querySelector('[data-carrel-shell] [aria-label=\"Desk\"]') !== null"))) {
    return fail('the page did not render')
  }
  const openDesk = "document.querySelector('.desk-name')?.textContent"
  if (mode === 'create') {
    // Through the same bridge the sidebar uses, then wait for the shell to show it.
    await page("window.carrel.workspace.createProject('Smoke test').then(() => window.carrel.workspace.createDesk('Second desk'))")
    await reload()
    if (!(await waitFor(`${openDesk} === 'Second desk'`))) return fail('the new desk did not open')
    const problem = await deskInteractions(window, page, waitFor)
    if (problem) return fail(problem)
  }
  if (mode === 'reopen') {
    if (!(await waitFor(`${openDesk} === 'Second desk'`))) {
      return fail(`a restart opened "${String(await page(openDesk))}" instead of "Second desk"`)
    }
    const desks = await page<string[]>("[...document.querySelectorAll('[aria-label=\"Desks\"] .row.desk')].map((row) => row.textContent)")
    if (!desks.includes('First desk')) return fail(`the sidebar lists ${JSON.stringify(desks)}`)
    // The sheet moved and resized in the first run comes back where it was left.
    if (!(await waitFor(`(() => { const s = document.querySelector('.sheet'); return !!s && s.style.left === '${MOVED.x}px' && s.style.top === '${MOVED.y}px' && s.style.width === '${SCALED.w}px' })()`))) {
      return fail(`the sheet came back at ${String(await page("document.querySelector('.sheet')?.getAttribute('style') ?? 'nowhere'"))}`)
    }
    if (!(await waitFor("document.querySelector('.zoom-level')?.textContent === '80%'"))) return fail('the desk did not come back at 80%')
    if (!(await waitFor(`document.querySelector('.sheet[data-kind="web_page"]')?.getAttribute('aria-label') === '${LINK_TITLE}'`))) {
      return fail('the web page sheet did not come back')
    }
    if (!(await waitFor("document.querySelector('.web-page img') !== null"))) return fail('the web page came back without its snapshot')
    if (!(await waitFor(`${PDF_TEXT} === 'Price elasticity of demand'`))) return fail(`the PDF came back saying ${String(await page(PDF_TEXT))}`)
    if (!(await waitFor(`window.carrel.workspace.thats().then((thats) => thats[0]?.label === 'p.1' && thats[0]?.text === '${THAT_WORD}')`))) {
      return fail('the that. did not come back')
    }
  }
  // Calls run in order, so this answers only after the gestures' saves are written.
  await page('window.carrel.workspace.state()')
  console.log('carrel smoke: ok')
  app.exit(0)
}

app.whenReady().then(async () => {
  serveDesk(fileURLToPath(new URL('renderer', import.meta.url)))
  const settled = serveWorkspace(controller)
  // Let the last save land before quitting.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void settled().finally(() => app.quit())
  })
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
}).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
