// A web sheet: a pencil bar while its page loads, and the page's own zoom
// (−, +, 100%, Fit) that stays with the sheet, and its right-click menu.
// A local server stands in for the web.
// Run `pnpm build` first.
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { catchMenus, menuShown, pick, quit, start } from './app.js'

let home: string
let server: Server
let link: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  // A slow page, wider than any sheet.
  server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><title>Wide page</title><div style="width: 2400px; height: 40px; background: #ccc">Wide page</div>')
    }, 1500)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  link = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wide`
})

test.afterAll(async () => {
  server.close()
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('a web page loads, zooms and fits', async () => {
  const { app, page } = await start(home, [])
  await page.getByLabel('Project name').fill('Web desk')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Web page or video link' }).click()
  await page.getByLabel('Link to a web page or video').fill(link)
  await page.keyboard.press('Enter')
  const sheet = page.locator('.sheet[data-kind="web_page"]')
  await expect(sheet).toBeVisible()

  // Focus opens the page; the pencil bar shows until it has loaded.
  await sheet.locator('.sheet-title').dblclick()
  await expect(sheet.getByRole('progressbar', { name: 'Loading page' })).toBeVisible()
  await expect(sheet.getByRole('progressbar')).toHaveCount(0, { timeout: 20_000 })

  // The page's own zoom, step by step, back to 100%, then fit to the sheet.
  const zoom = sheet.getByRole('button', { name: 'Page zoom' })
  await expect(zoom).toHaveText('100%')
  await sheet.getByRole('button', { name: 'Zoom page in' }).click()
  await expect(zoom).toHaveText('110%')
  await sheet.getByRole('button', { name: 'Zoom page out' }).click()
  await sheet.getByRole('button', { name: 'Zoom page out' }).click()
  await expect(zoom).toHaveText('90%')
  await zoom.click()
  await expect(zoom).toHaveText('100%')
  await sheet.getByRole('button', { name: 'Fit' }).click()
  await expect(zoom).not.toHaveText('100%')
  const fitted = Number((await zoom.textContent())!.replace('%', ''))
  expect(fitted).toBeLessThan(60)

  // It stays with the sheet after Focus.
  await page.keyboard.press('Escape')
  await expect(zoom).toHaveText(`${fitted}%`)
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
})

test('right-click words in a web page and ask the agent to explain them', async () => {
  // A home of its own, so the app starts on a new project.
  const own = await mkdtemp(join(home, 'menu-'))
  const { app, page } = await start(own, [])
  await catchMenus(app)
  await page.getByLabel('Project name').fill('Web menu')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Web page or video link' }).click()
  await page.getByLabel('Link to a web page or video').fill(link)
  await page.keyboard.press('Enter')
  const sheet = page.locator('.sheet[data-kind="web_page"]')
  await sheet.locator('.sheet-title').dblclick()
  await expect(sheet.getByRole('progressbar')).toHaveCount(0, { timeout: 20_000 })

  // The page is its own view, so select its words and right-click there from main.
  // The view can still be on its way when the loading bar clears, so wait for it.
  await expect
    .poll(() => app.evaluate(({ webContents }, link) => webContents.getAllWebContents().some((contents) => contents.getURL() === link && !contents.isLoading()), link), { timeout: 20_000 })
    .toBe(true)
  await app.evaluate(async ({ webContents }, link) => {
    const view = webContents.getAllWebContents().find((contents) => contents.getURL() === link)
    if (!view) throw new Error('The page is not open')
    await view.executeJavaScript("getSelection().selectAllChildren(document.querySelector('div'))")
    view.emit('context-menu', {}, { selectionText: 'Wide page', isEditable: false })
  }, link)
  expect(await menuShown(app)).toEqual(['that. [CommandOrControl+.]', 'Ask the agent about this…', 'Explain this', '—', 'copy'])
  await pick(app, 'Explain this')
  const panel = page.locator('.agent-panel')
  // The question points at the words, made a that. of the page.
  const asked = panel.locator('.agent-me').last()
  await expect(asked).toContainText('Explain this')
  await expect(asked.locator('.that-chip')).toHaveCount(1)
  await expect(page.locator('.that-tray .that-chip', { hasText: '127.0.0.1' })).toBeVisible()
  await quit(app)
})
