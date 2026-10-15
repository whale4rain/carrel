// Keyboard shortcuts are easy to find: one card lists them all (⌘/ or Ctrl+/,
// or Keyboard shortcuts in the sidebar), written the way this system writes
// keys, and the menu bar shows them beside its commands.
// Run `pnpm build` first.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { mod, quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

/** Clicks a command in the menu bar, as picking it there would. */
async function menuBar(app: ElectronApplication, menu: string, label: string): Promise<string | undefined> {
  return app.evaluate(({ Menu, BrowserWindow }, [menu, label]) => {
    const item = Menu.getApplicationMenu()
      ?.items.find((top) => top.label === menu)
      ?.submenu?.items.find((entry) => entry.label === label)
    if (!item) throw new Error(`No ${menu} › ${label}`)
    item.click(undefined, BrowserWindow.getAllWindows()[0])
    return item.accelerator ?? undefined
  }, [menu, label] as const)
}

test('the shortcut card, and shortcuts in the menu bar', async () => {
  const { app, page } = await start(home, [])
  await page.getByLabel('Project name').fill('Keys')
  await page.getByRole('button', { name: 'Create project' }).click()
  const ctrl = process.platform === 'darwin' ? '⌘' : 'Ctrl+'

  // ⌘/ (Ctrl+/) opens the card; keys read the way this system writes them.
  await page.keyboard.press(`${mod}+Slash`)
  const card = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(card).toBeVisible()
  const agent = card.locator('.shortcut', { hasText: 'Open or close the agent' })
  await expect(agent.locator('kbd')).toHaveText(`${ctrl}J`)
  await expect(card.locator('.shortcut', { hasText: 'Redo' }).locator('kbd')).toHaveText(process.platform === 'darwin' ? '⇧⌘Z' : 'Ctrl+Y')
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)

  // The sidebar has a way there too, with its shortcut beside it.
  const button = page.getByRole('navigation', { name: 'Project' }).getByRole('button', { name: /Keyboard shortcuts/ })
  await expect(button.locator('kbd')).toHaveText(`${ctrl}/`)
  await button.click()
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')

  // Tooltips carry the shortcut too.
  await expect(page.getByRole('button', { name: 'Zoom in' })).toHaveAttribute('title', `Zoom in (${ctrl}+)`)

  // The menu bar shows the keys, and its commands work: Help › Keyboard Shortcuts, Desk › Hand Tool.
  expect(await menuBar(app, 'Help', 'Keyboard Shortcuts')).toBe('CommandOrControl+/')
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  const hand = page.getByRole('button', { name: 'Hand' })
  await expect(hand).toHaveAttribute('aria-pressed', 'false')
  expect(await menuBar(app, 'Desk', 'Hand Tool')).toBe('H')
  await expect(hand).toHaveAttribute('aria-pressed', 'true')
  await quit(app)
})
