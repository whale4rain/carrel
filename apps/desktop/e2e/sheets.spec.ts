// Tidying a desk: fold a sheet down to its label and open it again, remove one
// from the desk (it stays in the library) and bring it back with undo.
// Run `pnpm build` first.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { tinyPdf } from '../scripts/tiny-pdf.mjs'
import { mod, quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  await writeFile(join(home, 'Reading.pdf'), tinyPdf('Supply and demand'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('fold, open and remove a sheet', async () => {
  const { app, page } = await start(home, ['Reading.pdf'])
  await page.getByLabel('Project name').fill('Tidy desk')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const sheet = page.locator('.sheet[data-kind="paper"]')
  await expect(sheet.locator('.textLayer')).toHaveText('Supply and demand')
  const open = (await sheet.boundingBox())!.height

  // Its label's fold button folds it to the label row; the viewer goes away.
  await sheet.getByRole('button', { name: 'Fold Reading' }).click()
  await expect(sheet).toHaveAttribute('data-folded', 'true')
  await expect(sheet.locator('.textLayer')).toHaveCount(0)
  expect((await sheet.boundingBox())!.height).toBeLessThan(open / 4)
  await expect(page.locator('.handle-e')).toHaveCount(0)

  // It stays folded after a restart.
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
  const again = await start(home, ['Reading.pdf'])
  const back = again.page.locator('.sheet[data-kind="paper"]')
  await expect(back).toHaveAttribute('data-folded', 'true')

  // Open from the label, and it comes back at its size with its page.
  await back.getByRole('button', { name: 'Open Reading' }).click()
  await expect(back.locator('.textLayer')).toHaveText('Supply and demand')
  expect(Math.round((await back.boundingBox())!.height)).toBe(Math.round(open))

  // Remove takes it off the desk; the library keeps it; undo puts it back.
  await back.locator('.sheet-label').click()
  await again.page.locator('.selection-bar').getByRole('button', { name: 'Remove' }).click()
  await expect(again.page.locator('.sheet')).toHaveCount(0)
  expect(await again.page.evaluate(() => window.carrel.workspace.items().then((items) => items.filter((item) => item.kind === 'paper').length))).toBe(1)
  await again.page.keyboard.press(`${mod}+KeyZ`)
  await expect(again.page.locator('.sheet[data-kind="paper"]')).toHaveCount(1)

  await again.page.evaluate(() => window.carrel.workspace.state())
  await quit(again.app)
})
