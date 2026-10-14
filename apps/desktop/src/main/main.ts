import { carrelRoots, Workspace } from '@carrel/core'
import { isTheme, type Theme } from '@carrel/margin'
import { app, BrowserWindow, nativeTheme } from 'electron'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { frameFor } from '../shared/frame.js'
import { ShellController } from './shell-state.js'
import { titleBarOverlay, windowOptions } from './window-options.js'
import { serveWorkspace } from './workspace-ipc.js'

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
  if (smoke) await runSmoke(window, smoke, () => window.loadFile(`${outDir}renderer/index.html`, { query: { frame } }))
  // `CARREL_SHOT=file.png` saves the window's page and quits, for PR screenshots.
  const shot = process.env.CARREL_SHOT
  if (shot) {
    await new Promise((resolve) => setTimeout(resolve, 800))
    await writeFile(shot, (await window.webContents.capturePage()).toPNG())
    app.exit(0)
  }
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
  }
  if (mode === 'reopen') {
    if (!(await waitFor(`${openDesk} === 'Second desk'`))) {
      return fail(`a restart opened "${String(await page(openDesk))}" instead of "Second desk"`)
    }
    const desks = await page<string[]>("[...document.querySelectorAll('[aria-label=\"Desks\"] .row.desk')].map((row) => row.textContent)")
    if (!desks.includes('First desk')) return fail(`the sidebar lists ${JSON.stringify(desks)}`)
  }
  console.log('carrel smoke: ok')
  app.exit(0)
}

app.whenReady().then(async () => {
  serveWorkspace(new ShellController(workspace))
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
