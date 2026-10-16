// A learning kit's sheet on the desk: added from the add menu, drawn in
// Margin inside a sandbox that can't reach the network or Carrel, and back
// after a restart. Run `pnpm build` first.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Frame, type Page } from '@playwright/test'
import { quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function kitFrame(page: Page): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => frame.url().startsWith('https://language.kit.carrel.app/'))).toBe(true)
  return page.frames().find((frame) => frame.url().startsWith('https://language.kit.carrel.app/'))!
}

test('lay a learning kit on the desk, in its sandbox', async () => {
  const { app, page } = await start(home)
  await page.getByLabel('Project name').fill('Spanish')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Learning kit' }).click()
  const kits = page.getByRole('menu', { name: 'Learning kits' })
  await expect(kits.getByRole('group', { name: 'Language' })).toContainText('three stages')
  await kits.getByRole('menuitem', { name: 'Stages' }).click()

  const sheet = page.locator('.sheet[data-kind="kit"]')
  await expect(sheet.locator('.sheet-kind')).toHaveText('Language')
  await expect(sheet.locator('.sheet-title')).toHaveText('Stages')
  const frame = await kitFrame(page)
  await expect(frame.locator('h1')).toHaveText('Language')
  await expect(frame.locator('li[aria-current="step"] h2')).toHaveText('Beginner')

  // Margin is in: the paper color, and the reading face for the title once fonts load.
  expect(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(252, 252, 249)')
  await expect.poll(() => frame.evaluate(() => document.fonts.ready.then(() => document.fonts.check('500 28px Literata')))).toBe(true)
  expect(await frame.evaluate(() => (window as unknown as { kit: { sheet: string } }).kit.sheet)).toBe('stages')

  // The sandbox: no network, no reach into Carrel, no storage, no leaving the kit.
  expect(await frame.evaluate(() => fetch('https://example.com/').then(() => 'reached', () => 'blocked'))).toBe('blocked')
  expect(await frame.evaluate(() => fetch('https://desk.carrel.app/index.html').then(() => 'reached', () => 'blocked'))).toBe('blocked')
  expect(await frame.evaluate(() => {
    try {
      return window.parent.document.title
    } catch {
      return 'blocked'
    }
  })).toBe('blocked')
  expect(await frame.evaluate(() => {
    try {
      return typeof localStorage.length
    } catch {
      return 'blocked'
    }
  })).toBe('blocked')
  // Going to another kit loads its own page again; the desk's frame policy stops the web.
  await frame.evaluate(() => {
    location.href = 'https://other.kit.carrel.app/sheets/stages.html'
  })
  await expect.poll(async () => (await kitFrame(page)).evaluate(() => location.href).catch(() => '')).toBe('https://language.kit.carrel.app/sheets/stages.html?sheet=stages')
  await expect((await kitFrame(page)).locator('h1')).toHaveText('Language')
  await (await kitFrame(page)).evaluate(() => {
    location.href = 'https://example.com/'
  })
  await expect.poll(() => page.frames().map((each) => each.url()).filter((url) => url.includes('example.com'))).toEqual([])

  // Adding it again brings the same sheet forward.
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Learning kit' }).click()
  await expect(kits.getByRole('group', { name: 'Language' })).toContainText('in this project')
  await kits.getByRole('menuitem', { name: 'Stages' }).click()
  await expect(sheet).toHaveCount(1)

  await page.waitForTimeout(800)
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
  const again = await start(home)
  await expect(again.page.locator('.sheet[data-kind="kit"] .sheet-title')).toHaveText('Stages')
  await expect((await kitFrame(again.page)).locator('h1')).toHaveText('Language')
  await quit(again.app)
})
