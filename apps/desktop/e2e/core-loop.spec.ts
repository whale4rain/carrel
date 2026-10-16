// The core loop, end to end, the way a person does it: start a project, add a
// PDF, point at a word with that., write a note citing it, ask the agent, accept
// what it proposes, then quit and start again to find it all still there.
// Real clicks and keys; the agent is the scripted model, so no network.
// Run `pnpm build` first.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { tinyPdf } from '../scripts/tiny-pdf.mjs'
import { mod, quit, start } from './app.js'

const NOTE_TITLE = 'Elasticity'
const NOTE_TEXT = 'Coffee is a habit, so it is inelastic.'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  await writeFile(join(home, 'Elasticity.pdf'), tinyPdf('Price elasticity of demand'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('a source, a that., a note, the agent, and a restart', async () => {
  const { app, page } = await start(home, ['Elasticity.pdf'])

  console.log('carrel e2e: started')
  // A project from the welcome screen.
  await page.getByLabel('Project name').fill('Learn economics')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.locator('.desk-name')).toBeVisible()

  console.log('carrel e2e: project made')
  // A PDF through + Add (the test stands in at the file dialog).
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const textLayer = page.locator('.sheet[data-kind="paper"] .textLayer')
  await expect(textLayer).toHaveText('Price elasticity of demand')

  console.log('carrel e2e: PDF shown')
  // that.: drag across the words with the mouse and press ⌘. (Ctrl+.).
  const words = (await textLayer.locator('span').first().boundingBox())!
  await page.mouse.move(words.x + 1, words.y + words.height / 2)
  await page.mouse.down()
  await page.mouse.move(words.x + words.width - 1, words.y + words.height / 2, { steps: 5 })
  await page.mouse.up()
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('Price elasticity of demand')
  await page.keyboard.press(`${mod}+Period`)
  const chip = page.locator('.that-tray .that-chip', { hasText: 'p.1' })
  await expect(chip).toBeVisible()

  console.log('carrel e2e: that. made')
  // A note from the desk's + Add, typed, with the chip dragged to the end of its text.
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.getByRole('menuitem', { name: /^Note/ }).click()
  const editor = page.locator('.sheet[data-kind="note"] .ProseMirror')
  await expect(editor).toBeFocused()
  await page.keyboard.type(NOTE_TITLE)
  await editor.locator('p').click()
  await page.keyboard.type(NOTE_TEXT)
  const line = editor.locator('p')
  const box = await line.boundingBox()
  await chip.dragTo(line, { targetPosition: { x: (box?.width ?? 2) - 2, y: (box?.height ?? 2) / 2 } })
  await expect(editor.locator('.note-chip')).toHaveText('p.1')
  await expect(page.locator('[aria-label="Notes"] .row.note')).toHaveText([NOTE_TITLE])
  await expect(page.locator('.sheet[data-kind="paper"] .cited-by button')).toHaveText('1 note')

  console.log('carrel e2e: note written')
  // The agent (⌘J) answers from the note.
  await page.keyboard.press(`${mod}+KeyJ`)
  const panel = page.locator('.agent-panel')
  await expect(panel).toBeVisible()
  const ask = async (question: string): Promise<void> => {
    const input = panel.locator('.agent-input textarea')
    await input.fill(question)
    await input.press('Enter')
    await expect(panel.locator('.agent-answer[data-live]')).toHaveCount(0)
  }
  await ask('What did I note about coffee?')
  await expect(panel.locator('.agent-answer .agent-text').last()).toContainText(NOTE_TITLE)

  console.log('carrel e2e: agent answered')
  // Asked for a note, it proposes one in pencil; nothing is written until Tab.
  const notes = page.locator('[aria-label="Notes"] .row.note')
  await ask('Make a note about coffee')
  await expect(panel.locator('.proposal[data-state="open"] .proposal-tag')).toContainText('SUGGEST')
  await expect(notes).toHaveCount(1)
  await expect(panel.locator('.agent-input textarea')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(panel.locator('.proposal[data-state="accepted"] .proposal-open')).toHaveText('Open note')
  await expect(notes).toHaveCount(2)

  console.log('carrel e2e: proposal accepted')
  // Let the last saves land, then quit.
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)

  console.log('carrel e2e: quit')
  // Started again, everything is where it was left.
  const again = await start(home, ['Elasticity.pdf'])
  const back = again.page
  await expect(back.locator('.sheet[data-kind="paper"] .textLayer')).toHaveText('Price elasticity of demand')
  await expect(back.locator('.that-tray .that-chip', { hasText: 'p.1' })).toBeVisible()
  await expect(back.locator('[aria-label="Notes"] .row.note')).toHaveCount(2)
  await back.getByRole('button', { name: NOTE_TITLE, exact: true }).click()
  // From the sidebar, a note opens on its own page.
  const note = back.locator('.note-page .ProseMirror')
  await expect(note.locator('h1')).toHaveText(NOTE_TITLE)
  await expect(note.locator('p')).toHaveText(`${NOTE_TEXT}p.1`)
  await expect(note.locator('.note-chip')).toHaveText('p.1')
  console.log('carrel e2e: restarted, note back')
  await back.locator('.agent-button').click()
  const thread = back.locator('.agent-panel')
  await expect(thread.locator('.agent-me')).toHaveCount(2)
  await expect(thread.locator('.proposal[data-state="accepted"]')).toHaveCount(1)
  await quit(again.app)
})
