// Focus with company: a note kept beside the focused source, dragged up from the
// shelf or pinned with Beside; the sheets share the width, and swap on a double-click.
// Run `pnpm build` first.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { tinyPdf } from '../scripts/tiny-pdf.mjs'
import { quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  await writeFile(join(home, 'Reading.pdf'), tinyPdf('Comparative advantage'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('keep a note and a sheet beside the focused source', async () => {
  const { app, page } = await start(home, ['Reading.pdf'])
  await page.getByLabel('Project name').fill('Beside desk')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const paper = page.locator('.sheet[data-kind="paper"]')
  await expect(paper.locator('.textLayer')).toHaveText('Comparative advantage')
  await page.locator('[aria-label="Notes"] button', { hasText: '+ New note' }).click()
  await expect(page.locator('.sheet[data-kind="note"] .ProseMirror')).toBeFocused()
  await page.keyboard.type('Trade')
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Blank sheet' }).click()
  await expect(page.locator('.sheet')).toHaveCount(3)

  // Focus the paper; drag the note's card up from the shelf: it sits beside, sharing the width.
  await paper.locator('.sheet-title').dblclick({ position: { x: 5, y: 5 } })
  await expect(page.locator('.sheet')).toHaveCount(1)
  const alone = (await paper.boundingBox())!.width
  const shelf = page.getByRole('navigation', { name: 'On this desk' })
  await shelf.locator('li', { hasText: 'Trade' }).locator('button').first().dragTo(page.locator('.desk-mat'), { targetPosition: { x: 40, y: 300 } })
  const note = page.locator('.sheet[data-kind="note"]')
  await expect(page.locator('.sheet')).toHaveCount(2)
  await expect(note).toBeVisible()
  expect((await paper.boundingBox())!.width).toBeLessThan(alone)
  expect((await note.boundingBox())!.x).toBeGreaterThan((await paper.boundingBox())!.x)

  // Write in it while the paper stays focused.
  await note.locator('.ProseMirror p').click()
  await page.keyboard.type('Each does what it gives up least for.')
  await expect(note.locator('.ProseMirror p')).toHaveText('Each does what it gives up least for.')
  await expect(page.locator('.sheet[data-focused]')).toHaveAttribute('aria-label', 'Reading')

  // Beside pins the blank sheet too; a double-click swaps it with the focused paper.
  await shelf.getByRole('button', { name: 'Keep beside: Blank sheet' }).click({ force: true })
  await expect(page.locator('.sheet')).toHaveCount(3)
  await expect(shelf.locator('.focus-shelf-empty')).toBeVisible()
  await page.locator('.sheet[aria-label="Blank sheet"] .sheet-title').dblclick()
  await expect(page.locator('.sheet[data-focused]')).toHaveAttribute('aria-label', 'Blank sheet')
  await expect(page.locator('.sheet')).toHaveCount(3)

  // × sends one back to the shelf; Esc leaves, and the pins wait for next time.
  await page.getByRole('button', { name: 'Back to the shelf: Trade' }).click()
  await expect(page.locator('.sheet')).toHaveCount(2)
  await expect(shelf.locator('li', { hasText: 'Trade' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.focus-bar')).toHaveCount(0)
  await expect(page.locator('.sheet')).toHaveCount(3)
  // The blank sheet is still selected: Focus again, and the paper is beside it.
  await page.getByRole('toolbar', { name: 'Actions for the selection' }).getByRole('button', { name: 'Focus' }).click()
  await expect(page.locator('.sheet[data-focused]')).toHaveAttribute('aria-label', 'Blank sheet')
  await expect(page.locator('.sheet')).toHaveCount(2)
  await expect(paper).toBeVisible()
  await quit(app)
})
