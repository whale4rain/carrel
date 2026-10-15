// The core loop, end to end, the way a person does it: start a project, add a
// PDF, point at a word with that., write a note citing it, ask the agent, accept
// what it proposes, then quit and start again to find it all still there.
// Real clicks and keys; the agent is the scripted model, so no network.
// Run `pnpm build` first.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { tinyPdf } from '../scripts/tiny-pdf.mjs'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const NOTE_TITLE = 'Elasticity'
const NOTE_TEXT = 'Coffee is a habit, so it is inelastic.'

let home: string
let current: Page | undefined

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  await writeFile(join(home, 'Elasticity.pdf'), tinyPdf('Price elasticity of demand'))
})

// Playwright reads fixtures from the first argument's pattern, so it must be there even when empty.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && current && !current.isClosed()) {
    await current.screenshot({ path: testInfo.outputPath('failed.png') }).catch(() => undefined)
  }
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function start(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    // Containers and CI Linux runners have no user namespace for Chromium's sandbox.
    args: process.platform === 'linux' ? [appDir, '--no-sandbox'] : [appDir],
    env: { ...process.env, CARREL_HOME: home, CARREL_CHOOSE_FILES: join(home, 'Elasticity.pdf'), CARREL_LLM: 'scripted' },
  })
  const page = await app.firstWindow()
  current = page
  await expect(page.locator('[data-carrel-shell] [aria-label="Desk"]')).toBeVisible()
  return { app, page }
}

test('a source, a that., a note, the agent, and a restart', async () => {
  const { app, page } = await start()

  // A project from the welcome screen.
  await page.getByLabel('Project name').fill('Learn economics')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.locator('.desk-name')).toBeVisible()

  // A PDF through + Add (the test stands in at the file dialog).
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const textLayer = page.locator('.sheet[data-kind="paper"] .textLayer')
  await expect(textLayer).toHaveText('Price elasticity of demand')

  // that.: select a word on the page and press ⌘. (Ctrl+.).
  await textLayer.evaluate((layer) => {
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text
      const at = text.data.indexOf('elasticity')
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + 'elasticity'.length)
      getSelection()?.removeAllRanges()
      getSelection()?.addRange(range)
      return
    }
  })
  await page.keyboard.press(`${mod}+Period`)
  const chip = page.locator('.that-tray .that-chip', { hasText: 'p.1' })
  await expect(chip).toBeVisible()

  // A note from the sidebar, typed, with the chip dragged to the end of its text.
  await page.locator('[aria-label="Notes"] button', { hasText: '+ New note' }).click()
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

  // Asked for a note, it proposes one in pencil; nothing is written until Tab.
  const notes = page.locator('[aria-label="Notes"] .row.note')
  await ask('Make a note about coffee')
  await expect(panel.locator('.proposal[data-state="open"] .proposal-tag')).toContainText('SUGGEST')
  await expect(notes).toHaveCount(1)
  await expect(panel.locator('.agent-input textarea')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(panel.locator('.proposal[data-state="accepted"] .proposal-open')).toHaveText('Open note')
  await expect(notes).toHaveCount(2)

  // Let the last saves land, then quit.
  await page.evaluate(() => window.carrel.workspace.state())
  await app.close()

  // Started again, everything is where it was left.
  const again = await start()
  const back = again.page
  await expect(back.locator('.sheet[data-kind="paper"] .textLayer')).toHaveText('Price elasticity of demand')
  await expect(back.locator('.that-tray .that-chip', { hasText: 'p.1' })).toBeVisible()
  await expect(back.locator('[aria-label="Notes"] .row.note')).toHaveCount(2)
  await back.getByRole('button', { name: NOTE_TITLE, exact: true }).click()
  const note = back.locator('.sheet[data-kind="note"][data-selected] .ProseMirror')
  await expect(note.locator('h1')).toHaveText(NOTE_TITLE)
  await expect(note.locator('p')).toHaveText(`${NOTE_TEXT}p.1`)
  await expect(note.locator('.note-chip')).toHaveText('p.1')
  await back.locator('.agent-button').click()
  const thread = back.locator('.agent-panel')
  await expect(thread.locator('.agent-me')).toHaveCount(2)
  await expect(thread.locator('.proposal[data-state="accepted"]')).toHaveCount(1)
  await again.app.close()
})
