// A web sheet: a pencil bar while its page loads, and the page's own zoom
// (−, +, 100%, Fit) that stays with the sheet. A local server stands in for the web.
// Run `pnpm build` first.
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { quit, start } from './app.js'

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
