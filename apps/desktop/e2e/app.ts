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
  // The desk, or the map when it is the start page.
  await expect(page.locator('[data-carrel-shell] :is([aria-label="Desk"], .memory-map)').first()).toBeVisible()
  return { app, page }
}

/** Goes to a place on the rail: Map, Today, Desks, Notes or Sources. Its column shows beside the rail. */
export async function place(page: Page, name: 'Map' | 'Today' | 'Desks' | 'Notes' | 'Sources'): Promise<void> {
  await page.getByRole('navigation', { name: 'Places' }).getByRole('button', { name: name === 'Map' ? 'Map of what you learned' : name, exact: true }).click()
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

// Right-click menus are native, so the tests catch them in main: `catchMenus`
// keeps them from opening, `menuShown` reads the one shown, `pick` clicks a line.

/** Keeps native menus from opening; the one last shown waits in main for `pick`. */
export async function catchMenus(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    const shown = globalThis as unknown as { menu?: { menu: Electron.Menu; options?: Electron.PopupOptions } }
    Menu.prototype.popup = function (this: Electron.Menu, options?: Electron.PopupOptions) {
      shown.menu = { menu: this, ...(options ? { options } : {}) }
    }
  })
}

/** The lines of the menu shown, once one is: labels with their shortcuts, the system's own commands by role. */
export async function menuShown(app: ElectronApplication): Promise<string[]> {
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { menu?: unknown }).menu !== undefined)).toBe(true)
  return app.evaluate(() =>
    (globalThis as unknown as { menu: { menu: Electron.Menu } }).menu.menu.items.map((item) =>
      item.type === 'separator' ? '—' : item.role ? item.role : `${item.label}${item.accelerator ? ` [${item.accelerator}]` : ''}`,
    ),
  )
}

/** Picks a line of the menu last shown, as a click on it would. */
export async function pick(app: ElectronApplication, label: string): Promise<void> {
  await app.evaluate((_electron, label) => {
    const { menu, options } = (globalThis as unknown as { menu: { menu: Electron.Menu; options?: Electron.PopupOptions } }).menu
    const item = menu.items.find((candidate) => candidate.label === label)
    if (!item) throw new Error(`No "${label}" in the menu`)
    item.click()
    options?.callback?.()
  }, label)
}
