// Starting and quitting the built app for the end-to-end tests.
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// No trailing separator: on Windows a path ending in \ before the closing quote escapes the quote.
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

let current: Page | undefined

// A failed test keeps a picture of the window it was looking at.
// Playwright reads fixtures from the first argument's pattern, so it must be there even when empty.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus && current && !current.isClosed()) {
    await current.screenshot({ path: testInfo.outputPath('failed.png') }).catch(() => undefined)
  }
})

/** Start the app against `home`, with the scripted model; `files` stand in at the file dialog. */
export async function start(home: string, files: string[] = []): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    // Containers and CI Linux runners have no user namespace for Chromium's sandbox.
    args: process.platform === 'linux' ? [appDir, '--no-sandbox'] : [appDir],
    env: { ...process.env, CARREL_HOME: home, CARREL_CHOOSE_FILES: files.map((file) => join(home, file)).join(delimiter), CARREL_LLM: 'scripted' },
    timeout: 30_000,
  })
  // What the app says goes to the test's output, so a stuck start shows why.
  app.process().stdout?.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
  app.process().stderr?.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`))
  const page = await app.firstWindow({ timeout: 30_000 })
  current = page
  await expect(page.locator('[data-carrel-shell] [aria-label="Desk"]')).toBeVisible()
  return { app, page }
}

/**
 * Quit the app. Playwright's close() waits for the process to end, which on the
 * Windows runner it can wait on forever; past ten seconds, end the process.
 * Saves are already written by then (the tests ask for the workspace state first).
 */
export async function quit(app: ElectronApplication): Promise<void> {
  const closed = app.close().then(() => true)
  const gave = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000))
  if (await Promise.race([closed, gave])) return
  console.warn('carrel e2e: the app did not quit within 10 s; ending it')
  app.process().kill()
}
