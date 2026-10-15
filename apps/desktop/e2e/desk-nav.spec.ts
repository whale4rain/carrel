// Getting around the desk: the hand moves the desk, not the sheet under it,
// and the map stays hidden until asked for and ignores drags that started
// elsewhere. Run `pnpm build` first.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const world = (page: Page): Promise<string | null> => page.locator('.desk-world').getAttribute('style')

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
}

const middle = (box: { x: number; y: number; width: number; height: number }): { x: number; y: number } => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })

test('the hand and the map', async () => {
  const { app, page } = await start(home)
  await page.getByLabel('Project name').fill('Getting around')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Blank sheet' }).click()
  const sheet = page.locator('.sheet')
  await expect(sheet).toHaveCount(1)

  // The map is hidden until asked for.
  await expect(page.locator('.minimap')).toHaveCount(0)
  await page.getByRole('button', { name: 'Map' }).click()
  const map = page.locator('.minimap')
  await expect(map).toBeVisible()

  // A resize whose drag passes over the map resizes the sheet and leaves the view alone.
  const before = await world(page)
  const width = (await sheet.boundingBox())!.width
  await drag(page, middle((await page.locator('.handle-e').boundingBox())!), middle((await map.boundingBox())!))
  expect(await world(page)).toBe(before)
  expect((await sheet.boundingBox())!.width).toBeGreaterThan(width)

  // With the hand on (H), dragging over the sheet moves the desk, not the sheet.
  await page.keyboard.press('h')
  await expect(page.getByRole('button', { name: 'Hand' })).toHaveAttribute('aria-pressed', 'true')
  const left = await sheet.evaluate((element) => element.style.left)
  const at = (await sheet.boundingBox())!
  await drag(page, middle(at), { x: at.x + at.width / 2 - 120, y: at.y + at.height / 2 - 60 })
  expect(await sheet.evaluate((element) => element.style.left)).toBe(left)
  const moved = (await sheet.boundingBox())!
  expect(Math.round(moved.x - at.x)).toBe(-120)
  expect(Math.round(moved.y - at.y)).toBe(-60)

  // H again puts the hand away: the same drag moves the sheet.
  await page.keyboard.press('h')
  await expect(page.getByRole('button', { name: 'Hand' })).toHaveAttribute('aria-pressed', 'false')
  await drag(page, middle((await page.locator('.sheet-label').boundingBox())!), { x: 600, y: 400 })
  expect(await sheet.evaluate((element) => element.style.left)).not.toBe(left)

  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
})
