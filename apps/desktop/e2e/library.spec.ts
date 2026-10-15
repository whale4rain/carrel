// The library: the project's sources and notes by shelf, from the sidebar.
// A source taken off the desk is still there and goes back with a click.
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
  await writeFile(join(home, 'Reading.pdf'), tinyPdf('Marginal cost'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('browse the library and put a source back on the desk', async () => {
  const { app, page } = await start(home, ['Reading.pdf'])
  await page.getByLabel('Project name').fill('Library desk')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const paper = page.locator('.sheet[data-kind="paper"]')
  await expect(paper.locator('.textLayer')).toHaveText('Marginal cost')
  await page.locator('[aria-label="Notes"] button', { hasText: '+ New note' }).click()
  const editor = page.locator('.sheet[data-kind="note"] .ProseMirror')
  await expect(editor).toBeFocused()
  await page.keyboard.type('Costs')
  await editor.locator('p').click()
  await page.keyboard.type('Rising at the margin #econ ')
  await expect(page.locator('[aria-label="Notes"] .row.note')).toHaveText(['Costs'])

  // Take the paper off the desk; it stays in the library.
  await paper.locator('.sheet-title').click()
  await page.getByRole('toolbar', { name: 'Actions for the selection' }).getByRole('button', { name: 'Remove' }).click()
  await expect(paper).toHaveCount(0)

  const sidebar = page.getByRole('navigation', { name: 'Project' })
  await sidebar.getByRole('button', { name: /Books & papers/ }).click()
  const library = page.getByRole('dialog', { name: 'Library' })
  await expect(library.getByRole('tab', { selected: true })).toContainText('Books & papers')
  const row = library.locator('.library-row', { hasText: 'Reading' })
  await expect(row.locator('.library-meta')).toContainText('PDF ·')
  await expect(row.locator('.library-where')).toHaveText('Put on desk')

  // Notes, filtered by tag.
  await library.getByRole('tab', { name: /Notes/ }).click()
  await expect(library.locator('.library-title')).toHaveText(['Costs'])
  await library.getByLabel('Filter the library').fill('#nothing')
  await expect(library.locator('.library-empty')).toHaveText('Nothing here matches.')
  await library.getByLabel('Filter the library').fill('#econ')
  await expect(library.locator('.library-title')).toHaveText(['Costs'])

  // Esc closes; All notes opens the Notes shelf.
  await page.keyboard.press('Escape')
  await expect(library).toHaveCount(0)
  await sidebar.getByRole('button', { name: /All notes/ }).click()
  await expect(library.getByRole('tab', { selected: true })).toContainText('Notes')

  // Back to Books & papers: a click puts the paper back on the desk.
  await library.getByRole('tab', { name: /Books & papers/ }).click()
  await row.click()
  await expect(library).toHaveCount(0)
  await expect(paper.locator('.textLayer')).toHaveText('Marginal cost')
  await sidebar.getByRole('button', { name: /Books & papers/ }).click()
  await expect(row.locator('.library-where')).toHaveText('On this desk')
  await quit(app)
})
