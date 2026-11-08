// The margin: select words in a PDF and a pencil line runs to a box beside the
// sheet; a question asked there is answered at the end of the line, and the
// line is still there after a restart. The agent is the scripted model.
// Run `pnpm build` first.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { tinyPdf } from '../scripts/tiny-pdf.mjs'
import { place, quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  await writeFile(join(home, 'Paging.pdf'), tinyPdf('A block table maps logical blocks to physical ones'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function selectWords(page: Page): Promise<void> {
  const words = (await page.locator('.sheet[data-kind="paper"] .textLayer span').first().boundingBox())!
  await page.mouse.move(words.x + 1, words.y + words.height / 2)
  await page.mouse.down()
  await page.mouse.move(words.x + words.width - 1, words.y + words.height / 2, { steps: 5 })
  await page.mouse.up()
}

test('selecting words draws a line to the margin, where the agent answers', async () => {
  const { app, page } = await start(home, ['Paging.pdf'])
  await page.getByLabel('Project name').fill('Systems')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  await expect(page.locator('.sheet[data-kind="paper"] .textLayer')).toHaveText('A block table maps logical blocks to physical ones')

  // Selecting words opens the margin's box, with a line to it.
  await selectWords(page)
  const box = page.getByRole('dialog', { name: 'Write in the margin' })
  await expect(box).toBeVisible()
  await expect(page.locator('.margin-lines path')).toHaveCount(1)
  // Esc lets it go.
  await box.getByLabel('Write a note, or ask').press('Escape')
  await expect(box).toHaveCount(0)
  await expect(page.locator('.margin-lines path')).toHaveCount(0)

  // A note of your own stays at the end of the line.
  await selectWords(page)
  await box.getByLabel('Write a note, or ask').fill('Like a page table.')
  await box.getByRole('button', { name: 'Note' }).click()
  const notes = page.locator('.margin-note')
  await expect(notes).toHaveCount(1)
  await expect(notes.first().locator('.margin-ink')).toHaveText('Like a page table.')

  // A question is answered in pencil at the end of its own line.
  await selectWords(page)
  await box.getByLabel('Write a note, or ask').fill('Why not keep the blocks together?')
  await box.getByLabel('Write a note, or ask').press('Enter')
  await expect(notes).toHaveCount(2)
  const asked = notes.filter({ hasText: 'Why not keep the blocks together?' })
  await expect(asked.locator('.margin-pencil')).not.toHaveText('')
  await expect(page.locator('.margin-lines path')).toHaveCount(2)

  // Tab keeps the answer as a note.
  await asked.click()
  await asked.getByLabel('Answer, or ask more').press('Tab')
  await expect(asked.locator('.margin-kept')).toContainText('Kept in')

  const saved = JSON.parse(await readFile(join(home, 'Carrel', 'Systems', 'margin.json'), 'utf8')) as { lines: Array<{ that?: string; entries: Array<{ by: string }> }> }
  expect(saved.lines.map((line) => line.entries.map((entry) => entry.by))).toEqual([['user'], ['user', 'agent']])
  expect(saved.lines.every((line) => typeof line.that === 'string')).toBe(true)
  await quit(app)

  // After a restart the lines are drawn again from the words.
  const again = await start(home)
  await expect(again.page.locator('.margin-note')).toHaveCount(2)
  await expect(again.page.locator('.margin-lines path')).toHaveCount(2)
  await quit(again.app)
})

test('in a note the agent thinks with you, or waits to be asked', async () => {
  const { app, page } = await start(home)
  await place(page, 'Notes')
  await page.locator('.place-column [aria-label="Notes"]').getByRole('button', { name: '+ New note' }).click()
  const editor = page.locator('.note-page .ProseMirror')
  await expect(editor).toBeFocused()
  await page.keyboard.type('Paging')
  await page.keyboard.press('Enter')

  // It reads along: a finished sentence, a pause, and one question in the margin, tied to the sentence.
  await expect(page.getByRole('button', { name: 'Thinks with you' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.type('The block table is a page table for the KV cache.')
  const said = page.locator('.note-page .margin-note[data-by="agent"]')
  await expect(said).toHaveCount(1, { timeout: 15_000 })
  await expect(said.locator('.margin-pencil')).toHaveText('What would change if that were not true?')
  await expect(page.locator('.note-page .margin-lines path')).toHaveCount(1)

  // When you ask, it keeps quiet until you select words and ask.
  await page.getByRole('button', { name: 'When you ask' }).click()
  await editor.locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Blocks are freed when no sequence uses them.')
  await page.waitForTimeout(4500)
  await expect(said).toHaveCount(1)
  const last = (await editor.locator('p', { hasText: 'Blocks are freed' }).boundingBox())!
  await page.mouse.move(last.x + 1, last.y + last.height / 2)
  await page.mouse.down()
  await page.mouse.move(last.x + 120, last.y + last.height / 2, { steps: 5 })
  await page.mouse.up()
  const box = page.getByRole('dialog', { name: 'Write in the margin' })
  await box.getByLabel('Write a note, or ask').fill('How are they counted?')
  await box.getByLabel('Write a note, or ask').press('Enter')
  const asked = page.locator('.note-page .margin-note', { hasText: 'How are they counted?' })
  await expect(asked.locator('.margin-pencil')).not.toHaveText('')
  await expect(page.locator('.note-page .margin-lines path')).toHaveCount(2)
  await quit(app)
})
