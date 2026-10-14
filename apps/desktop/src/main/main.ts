import { isTheme, type Theme } from '@carrel/margin'
import { app, BrowserWindow, nativeTheme } from 'electron'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { frameFor } from '../shared/frame.js'
import { titleBarOverlay, windowOptions } from './window-options.js'

const outDir = fileURLToPath(new URL('.', import.meta.url))

// `CARREL_SMOKE=1` opens the window, checks the page rendered, and quits.
// CI uses it to prove the app starts on Mac and Windows.
const smoke = process.env.CARREL_SMOKE === '1'

// Carrel follows the system's light or dark mode. `CARREL_THEME=day|night`
// forces one, for screenshots and checks.
const forced = process.env.CARREL_THEME
if (forced && isTheme(forced)) nativeTheme.themeSource = forced === 'night' ? 'dark' : 'light'
const currentTheme = (): Theme => (nativeTheme.shouldUseDarkColors ? 'night' : 'day')

async function createWindow(): Promise<void> {
  const window = new BrowserWindow(windowOptions(process.platform, `${outDir}preload.cjs`, currentTheme()))
  window.once('ready-to-show', () => window.show())
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
  await window.loadFile(`${outDir}renderer/index.html`, { query: { frame } })
  if (smoke) await checkRendered(window)
  // `CARREL_SHOT=file.png` saves the window's page and quits, for PR screenshots.
  const shot = process.env.CARREL_SHOT
  if (shot) {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await writeFile(shot, (await window.webContents.capturePage()).toPNG())
    app.exit(0)
  }
}

async function checkRendered(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const rendered: unknown = await window.webContents.executeJavaScript(
      "document.querySelector('[data-carrel-shell] [aria-label=\"Desk\"]') !== null",
    )
    if (rendered === true) {
      console.log('carrel smoke: ok')
      app.exit(0)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  console.error('carrel smoke: the page did not render')
  app.exit(1)
}

app.whenReady().then(async () => {
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
