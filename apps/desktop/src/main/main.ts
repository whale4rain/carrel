import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import { windowOptions } from './window-options.js'

const outDir = fileURLToPath(new URL('.', import.meta.url))

// `CARREL_SMOKE=1` opens the window, checks the page rendered, and quits.
// CI uses it to prove the app starts on Mac and Windows.
const smoke = process.env.CARREL_SMOKE === '1'

async function createWindow(): Promise<void> {
  const window = new BrowserWindow(windowOptions(process.platform, `${outDir}preload.cjs`))
  window.once('ready-to-show', () => window.show())
  if (smoke) {
    // Show renderer errors in the CI log, so a blank page says why.
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error') console.error(`renderer: ${message}`)
    })
  }
  await window.loadFile(`${outDir}renderer/index.html`)
  if (smoke) await checkRendered(window)
}

async function checkRendered(window: BrowserWindow): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const heading: unknown = await window.webContents.executeJavaScript(
      "document.querySelector('h1')?.textContent ?? null",
    )
    if (heading === 'Carrel') {
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
