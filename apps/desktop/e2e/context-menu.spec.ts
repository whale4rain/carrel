// Right-click menus: point at words in a PDF, ask the agent to explain them,
// and ask it to rewrite words in a note. The menus are native, so the test
// catches them in main, reads their lines and picks one.
// Run `pnpm build` first.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { tinyPdf } from '../scripts/tiny-pdf.mjs'
import { catchMenus, menuShown, pick, quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  await writeFile(join(home, 'Reading.pdf'), tinyPdf('Opportunity cost'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** Right-clicks at a point and returns the lines of the menu that opens. */
async function menuAt(app: ElectronApplication, page: Page, x: number, y: number): Promise<string[]> {
  await app.evaluate(() => delete (globalThis as unknown as { menu?: unknown }).menu)
  await page.mouse.click(x, y, { button: 'right' })
  return menuShown(app)
}

test('right-click points at words and asks the agent about them', async () => {
  const { app, page } = await start(home, ['Reading.pdf'])
  await catchMenus(app)
  await page.getByLabel('Project name').fill('Menus')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const paper = page.locator('.sheet[data-kind="paper"]')
  await expect(paper.locator('.textLayer')).toHaveText('Opportunity cost')

  // Select the words, right-click them: that., the agent, and Copy.
  const words = (await paper.locator('.textLayer span').first().boundingBox())!
  const middle = words.y + words.height / 2
  await page.mouse.move(words.x + 1, middle)
  await page.mouse.down()
  await page.mouse.move(words.x + words.width - 1, middle, { steps: 5 })
  await page.mouse.up()
  expect(await menuAt(app, page, words.x + words.width / 2, middle)).toEqual([
    'that. [CommandOrControl+.]',
    'Ask the agent about this…',
    'Explain this',
    '—',
    'copy',
  ])
  await pick(app, 'that.')
  await expect(page.locator('.that-tray .that-chip', { hasText: 'p.1' })).toBeVisible()

  // Explain this: the agent opens and answers about those words.
  await menuAt(app, page, words.x + words.width / 2, middle)
  await pick(app, 'Explain this')
  const panel = page.locator('.agent-panel')
  await expect(panel.locator('.agent-me').last()).toContainText('Explain this')
  await expect(panel.locator('.agent-answer[data-live]')).toHaveCount(0)
  await expect(panel.locator('.agent-answer .agent-text').last()).toContainText('You are pointing at')
  await panel.locator('.agent-input textarea').press('Escape').catch(() => undefined)

  // In a note: ask the agent to rewrite the selected words; you finish the question.
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.getByRole('menuitem', { name: /^Note/ }).click()
  const editor = page.locator('.sheet[data-kind="note"] .ProseMirror')
  await expect(editor).toBeFocused()
  await page.keyboard.type('Costs are what you give up.')
  // Select the title's words (a sent Shift+Home doesn't select a line on a Mac).
  await editor.locator('h1').evaluate((line) => getSelection()?.selectAllChildren(line))
  await expect.poll(() => page.evaluate(() => String(getSelection()))).toBe('Costs are what you give up.')
  const line = (await editor.locator('h1').boundingBox())!
  expect(await menuAt(app, page, line.x + 20, line.y + line.height / 2)).toEqual([
    'Ask the agent about this…',
    'Rewrite with the agent…',
    '—',
    'cut',
    'copy',
    'paste',
  ])
  await pick(app, 'Rewrite with the agent…')
  const input = panel.locator('.agent-input textarea')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue(/rewrite this: "Costs are what you give up\."/)
  await quit(app)
})
