// The shell around the desk: the sidebar folds away and is remembered, and the
// library opens above Focus's bar.
// Run `pnpm build` first.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { tinyPdf } from '../scripts/tiny-pdf.mjs'
import { mod, place, quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  await writeFile(join(home, 'Reading.pdf'), tinyPdf('Scarcity'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('fold the sidebar, and the library over Focus', async () => {
  const { app, page } = await start(home, ['Reading.pdf'])
  await page.getByLabel('Project name').fill('Shell desk')
  await page.getByRole('button', { name: 'Create project' }).click()
  const sidebar = page.getByRole('navigation', { name: 'Sidebar' })
  const desk = page.locator('.desk-mat')
  await expect(sidebar).toBeVisible()
  await expect(page.locator('.desk-name')).toBeVisible()
  const width = async (): Promise<number> => (await desk.boundingBox())?.width ?? 0
  await expect.poll(width).toBeGreaterThan(0)
  const narrow = await width()

  // The button hides it and the desk takes the room; ⌘\ (Ctrl+\) brings it back.
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  await expect(sidebar).toHaveCount(0)
  await expect.poll(width).toBeGreaterThan(narrow + 200)
  await page.keyboard.press(`${mod}+Backslash`)
  await expect(sidebar).toBeVisible()

  // Focus a paper, then open the library: it sits above Focus's bar.
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  await page.locator('.sheet[data-kind="paper"] .sheet-title').dblclick()
  await expect(page.locator('.focus-bar')).toBeVisible()
  await place(page, 'Sources')
  await sidebar.getByRole('button', { name: /Books & papers/ }).click()
  const library = page.getByRole('dialog', { name: 'Library' })
  await expect(library).toBeVisible()
  const bar = (await page.locator('.focus-bar').boundingBox())!
  const onTop = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.library-scrim') !== null, { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 })
  expect(onTop).toBe(true)
  await page.keyboard.press('Escape')
  await expect(library).toHaveCount(0)

  // Hidden, it stays hidden after a restart.
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  await quit(app)
  const again = await start(home, ['Reading.pdf'])
  await expect(again.page.locator('.desk-mat')).toBeVisible()
  await expect(again.page.getByRole('navigation', { name: 'Sidebar' })).toHaveCount(0)
  // The rail stays when the column is folded.
  await expect(again.page.getByRole('navigation', { name: 'Places' })).toBeVisible()
  await expect(again.page.getByRole('button', { name: 'Show sidebar' })).toBeVisible()
  await quit(again.app)
})
