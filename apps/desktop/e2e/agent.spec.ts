// The agent as a place: it opens from the rail, says what it sees, offers next
// steps that fit, and keeps its threads as tabs.
// Run `pnpm build` first.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { place, quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('the first run: a sentence about what you learn names the project', async () => {
  const first = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  const { app, page } = await start(first)
  await expect(page.getByRole('heading', { name: 'What are you learning?' })).toBeVisible()
  await page.getByLabel('What are you learning?').fill('I’m reading Mankiw’s Principles and watching the MIT lectures')
  await expect(page.getByLabel('Project name')).toHaveValue('Mankiw’s Principles')
  if (process.env.SHOT_FIRST) await page.screenshot({ path: process.env.SHOT_FIRST })
  // The name can be changed before it is made.
  await page.getByLabel('Project name').fill('Learn economics')
  await page.getByLabel('What are you learning?').press('Enter')
  await expect(page.locator('.desk-name')).toHaveText('First desk')
  await expect(page.locator('.crumb').first()).toContainText('Learn economics')
  await quit(app)
  await rm(first, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('the agent opens from the rail, sees what is open, and keeps threads as tabs', async () => {
  const { app, page } = await start(home)
  await page.getByLabel('Project name').fill('Agent desk')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.locator('.desk-name')).toBeVisible()

  // The rail's Agent opens it; it says what it sees and what it can do.
  await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: 'Agent', exact: true }).click()
  const panel = page.locator('.agent-panel')
  await expect(panel.locator('.agent-title')).toContainText('sees the desk “First desk”')
  await expect(panel.getByRole('list', { name: 'What the agent can do' })).toContainText('Recall other days')
  const tabs = panel.getByRole('tablist', { name: 'Threads' })
  await expect(tabs.getByRole('tab', { selected: true })).toHaveText('Project thread')

  // A suggested next step asks at once.
  await panel.getByRole('button', { name: 'What’s on this desk, in a few lines?' }).click()
  await expect(panel.locator('.agent-me')).toHaveCount(1)
  await expect(panel.locator('.agent-answer:not([data-live])')).toHaveCount(1)

  // On the map, it sees the map, and its next steps change.
  await place(page, 'Map')
  await expect(panel.locator('.agent-title')).toContainText('sees the Map')
  await expect(panel.getByRole('button', { name: 'What did I keep today?' })).toBeVisible()

  // + New starts a side thread; its first question names its tab.
  await tabs.getByRole('button', { name: 'New side thread' }).click()
  await expect(tabs.getByRole('tab', { selected: true })).toHaveText('New side thread')
  await panel.getByLabel('Ask the agent').fill('Fuel versus coffee')
  await panel.getByLabel('Ask the agent').press('Enter')
  await expect(tabs.getByRole('tab', { selected: true })).toHaveText(/Fuel versus coffee/)
  await tabs.getByRole('tab', { name: 'Project thread' }).click()
  await expect(panel.locator('.agent-me')).toHaveCount(1)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
  await quit(app)
})
