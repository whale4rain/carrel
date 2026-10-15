// Bookmarks in a book: keep the page you're reading with the ribbon or ⌘D
// (Ctrl+D), find it again in Contents, and still have it after a restart.
// Run `pnpm build` first.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bookPdf } from '../scripts/tiny-pdf.mjs'
import { mod, quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  const pages = Array.from({ length: 12 }, (_, i) => `Page ${i + 1} of the book`)
  await writeFile(join(home, 'Book.pdf'), bookPdf(pages, []))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('bookmark pages and go back to them', async () => {
  const { app, page } = await start(home, ['Book.pdf'])
  await page.getByLabel('Project name').fill('Bookmarks')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const sheet = page.locator('.sheet[data-kind="paper"]')
  await expect(sheet.locator('.pdf-page').first().locator('.textLayer')).toHaveText('Page 1 of the book')
  const jump = sheet.getByLabel('Go to page')
  const goTo = async (number: number): Promise<void> => {
    await jump.click()
    await page.keyboard.type(String(number))
    await page.keyboard.press('Enter')
    await expect(jump).toHaveValue(String(number))
  }

  // The ribbon keeps page 4, named by its first words; the page wears a ribbon too.
  await goTo(4)
  await sheet.getByRole('button', { name: 'Bookmark page 4' }).click()
  await expect(sheet.getByRole('button', { name: 'Remove the bookmark on page 4' }).first()).toHaveAttribute('aria-pressed', 'true')
  await expect(sheet.locator('.pdf-page[data-page="4"] .pdf-ribbon')).toHaveCount(1)

  // ⌘D (Ctrl+D) keeps page 10, with the sheet selected.
  await goTo(10)
  await sheet.locator('.sheet-title').click()
  await page.keyboard.press(`${mod}+KeyD`)
  await expect(sheet.locator('.pdf-page[data-page="10"] .pdf-ribbon')).toHaveCount(1)

  // Contents lists them in page order and goes back to one.
  await sheet.getByRole('button', { name: 'Contents' }).click()
  const marks = sheet.getByRole('list', { name: 'Bookmarks' })
  await expect(marks.locator('li > button:first-child')).toHaveText(['Page 4 of the book4', 'Page 10 of the book10'])
  await marks.getByRole('button', { name: /Page 4 of the book/ }).click()
  await expect(jump).toHaveValue('4')

  // They are kept: after a restart, Contents still has them, and × lets one go.
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
  const again = await start(home, ['Book.pdf'])
  const back = again.page.locator('.sheet[data-kind="paper"]')
  await back.getByRole('button', { name: 'Contents' }).click()
  const kept = back.getByRole('list', { name: 'Bookmarks' })
  await expect(kept.locator('li')).toHaveCount(2)
  await kept.getByRole('button', { name: 'Remove the bookmark on page 4' }).click()
  await expect(kept.locator('li')).toHaveCount(1)
  await expect(back.locator('.pdf-page[data-page="4"] .pdf-ribbon')).toHaveCount(0)
  await quit(again.app)
})
