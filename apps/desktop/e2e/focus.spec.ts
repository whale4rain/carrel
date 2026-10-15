// Focus: one sheet fills the desk, the rest wait on the shelf, Esc puts the desk
// back exactly as it was. Text in a focused PDF can still be pointed at.
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
  await writeFile(join(home, 'Reading.pdf'), tinyPdf('Opportunity cost'))
})

test.afterAll(async () => {
  await rm(home, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  })
})

test('focus a sheet, swap from the shelf, and go back', async () => {
  const { app, page } = await start(home, ['Reading.pdf'])
  await page.getByLabel('Project name').fill('Focus desk')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const paper = page.locator('.sheet[data-kind="paper"]')
  await expect(paper.locator('.textLayer')).toHaveText('Opportunity cost')
  // A blank sheet beside it, from + Add.
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Blank sheet' }).click()
  await expect(page.locator('.sheet')).toHaveCount(2)
  // Where each sheet is and how big (a click raises it, so not its z).
  const places = (): Promise<string[]> =>
    page.locator('.sheet').evaluateAll((all) =>
      all.map((one) => {
        const s = (one as HTMLElement).style
        return `${s.left} ${s.top} ${s.width} ${s.height}`
      }),
    )
  const before = await places()
  const world = await page.locator('.desk-world').getAttribute('style')

  // Double-click the label: the paper fills the desk, the blank sheet waits on the shelf.
  await paper.locator('.sheet-title').dblclick()
  await expect(page.locator('.focus-bar')).toContainText('Back to desk')
  await expect(page.locator('.sheet')).toHaveCount(1)
  const shelf = page.getByRole('navigation', { name: 'On this desk' })
  const cards = shelf.locator('li > button:not(.focus-pin)')
  await expect(cards).toHaveText(['SheetBlank sheet'])
  await expect(page.locator('.desk-nav')).toHaveCount(0)
  await expect(page.locator('.handle-e')).toHaveCount(0)
  const screen = (await page.locator('.desk-mat').boundingBox())!
  expect((await paper.boundingBox())!.width).toBeGreaterThan(screen.width / 2)

  // Its words can still be pointed at.
  const words = (await paper.locator('.textLayer span').first().boundingBox())!
  await page.mouse.move(words.x + 1, words.y + words.height / 2)
  await page.mouse.down()
  await page.mouse.move(words.x + words.width - 1, words.y + words.height / 2, {
    steps: 5,
  })
  await page.mouse.up()
  await page.keyboard.press(`${mod}+Period`)
  await expect(page.locator('.that-tray .that-chip', { hasText: 'p.1' })).toBeVisible()

  // A card on the shelf swaps in.
  await cards.filter({ hasText: 'Blank sheet' }).click()
  await expect(page.locator('.sheet')).toHaveCount(1)
  await expect(page.locator('.sheet[data-focused]')).toHaveAttribute('aria-label', 'Blank sheet')
  await expect(cards).toHaveText(['PaperReading'])

  // Esc: the desk is back exactly as it was.
  await page.keyboard.press('Escape')
  await expect(page.locator('.focus-bar')).toHaveCount(0)
  await expect(page.locator('.sheet')).toHaveCount(2)
  expect(await places()).toEqual(before)
  expect(await page.locator('.desk-world').getAttribute('style')).toBe(world)

  // ⌘↵ (Ctrl+Enter) focuses the selected sheet too.
  await paper.locator('.sheet-title').click()
  await page.keyboard.press(`${mod}+Enter`)
  await expect(page.locator('.sheet[data-focused]')).toHaveAttribute('aria-label', 'Reading')
  await page.keyboard.press('Escape')
  await expect(page.locator('.focus-bar')).toHaveCount(0)
  await quit(app)
})
