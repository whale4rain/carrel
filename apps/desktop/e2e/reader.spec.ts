// Reading a book: its contents list, jumping to a page, zooming the pages, and
// coming back to the same page after a restart.
// Run `pnpm build` first.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bookPdf } from '../scripts/tiny-pdf.mjs'
import { quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  const pages = Array.from({ length: 12 }, (_, i) => `Page ${i + 1} of the book`)
  await writeFile(join(home, 'Book.pdf'), bookPdf(pages, [
    { title: 'Scarcity', page: 1 },
    { title: 'Markets', page: 5 },
    { title: 'Money', page: 9 },
  ]))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('contents, jump, zoom, and the last page read', async () => {
  const { app, page } = await start(home, ['Book.pdf'])
  await page.getByLabel('Project name').fill('Reading desk')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const sheet = page.locator('.sheet[data-kind="paper"]')
  await expect(sheet.locator('.pdf-page').first().locator('.textLayer')).toHaveText('Page 1 of the book')
  const jump = sheet.getByLabel('Go to page')
  await expect(jump).toHaveValue('1')

  // The contents list goes to a chapter.
  await sheet.getByRole('button', { name: 'Contents' }).click()
  const contents = sheet.getByRole('navigation', { name: 'Contents' })
  await expect(contents.getByRole('button')).toHaveText(['Scarcity1', 'Markets5', 'Money9'])
  await contents.getByRole('button', { name: /Markets/ }).click()
  await expect(contents).toHaveCount(0)
  await expect(jump).toHaveValue('5')

  // A page number typed goes there.
  await jump.click()
  await page.keyboard.type('9')
  await page.keyboard.press('Enter')
  await expect(jump).toHaveValue('9')
  await expect(sheet.locator('.pdf-page[data-page="9"] .textLayer')).toHaveText('Page 9 of the book')

  // Zoom: wider pages, still on page 9; the percent fits the width again.
  const width = async (): Promise<number> => (await sheet.locator('.pdf-page').first().boundingBox())!.width
  const fitted = await width()
  await sheet.getByRole('button', { name: 'Zoom pages in' }).click()
  await expect(sheet.getByRole('button', { name: 'Pages zoom' })).toHaveText('110%')
  await expect.poll(width).toBeGreaterThan(fitted * 1.05)
  await expect(jump).toHaveValue('9')
  await sheet.getByRole('button', { name: 'Pages zoom' }).click()
  await expect(sheet.getByRole('button', { name: 'Pages zoom' })).toHaveText('100%')

  // After a restart it opens where it was left.
  await page.waitForTimeout(1000)
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
  const again = await start(home, ['Book.pdf'])
  const back = again.page.locator('.sheet[data-kind="paper"]')
  await expect(back.getByLabel('Go to page')).toHaveValue('9')
  await quit(again.app)
})
