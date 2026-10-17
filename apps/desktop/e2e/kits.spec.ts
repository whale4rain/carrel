// A learning kit's sheet on the desk: added from the add menu, drawn in
// Margin inside a sandbox that can't reach the network or Carrel, and back
// after a restart. Run `pnpm build` first.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Frame, type Page } from '@playwright/test'
import { mod, quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function kitFrame(page: Page, kit = 'language', sheet?: string): Promise<Frame> {
  const origin = `https://${kit}.kit.carrel.app/`
  const mine = (frame: Frame): boolean => frame.url().startsWith(origin) && (sheet === undefined || frame.url().endsWith(`sheet=${sheet}`))
  await expect.poll(() => page.frames().some(mine)).toBe(true)
  return page.frames().find(mine)!
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
  // It asks once, the first time.
  const asking = page.getByRole('dialog', { name: 'Allow Language' })
  await expect(asking.locator('li')).toHaveText(['Read your that.s and the words they point at', 'Schedule reviews', 'Ask the agent questions (each one shows in the thread)'])
  await asking.getByRole('button', { name: 'Allow' }).click()

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

// A kit made on this computer, in ~/.carrel/kits: a counter kept in its store.
const COUNTER = `<!doctype html>
<html><head><style>body { background: var(--paper); color: var(--ink); font: var(--text-body); padding: var(--space-4); }</style></head>
<body>
  <p>Clicked <output id="n">…</output> times.</p>
  <button id="add">Count</button>
  <script>
    const show = async () => {
      document.getElementById('n').textContent = String((await kit.store.get('counts', 'clicks')) ?? 0)
    }
    document.getElementById('add').addEventListener('click', async () => {
      await kit.store.set('counts', 'clicks', ((await kit.store.get('counts', 'clicks')) ?? 0) + 1)
      await show()
    })
    show()
  </script>
</body></html>`

test('a kit keeps its own store, and asks before it reads the project', async () => {
  const own = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  const folder = join(own, '.carrel', 'kits', 'counter')
  await mkdir(folder, { recursive: true })
  await writeFile(
    join(folder, 'kit.json'),
    JSON.stringify({ name: 'counter', title: 'Counter', description: 'Counts.', sheets: [{ id: 'count', title: 'Count', file: 'count.html', size: { w: 320, h: 240 } }], store: { counts: { schemaVersion: 1 } }, reads: ['thats'] }),
  )
  await writeFile(join(folder, 'count.html'), COUNTER)
  const { app, page } = await start(own)
  await page.getByLabel('Project name').fill('Counting')
  await page.getByRole('button', { name: 'Create project' }).click()

  // It asks first; "Not now" adds nothing.
  const pick = async (): Promise<void> => {
    await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
    await page.locator('.add-menu button', { hasText: 'Learning kit' }).click()
    await page.getByRole('menu', { name: 'Learning kits' }).getByRole('menuitem', { name: 'Count' }).click()
  }
  await pick()
  const asking = page.getByRole('dialog', { name: 'Allow Counter' })
  await expect(asking.locator('li')).toHaveText(['Read your that.s and the words they point at'])
  await asking.getByRole('button', { name: 'Not now' }).click()
  await expect(page.locator('.sheet[data-kind="kit"]')).toHaveCount(0)
  await pick()
  await asking.getByRole('button', { name: 'Allow' }).click()

  const frame = await kitFrame(page, 'counter')
  await expect(frame.locator('#n')).toHaveText('0')
  await frame.locator('#add').click()
  await frame.locator('#add').click()
  await expect(frame.locator('#n')).toHaveText('2')

  // What it was allowed works; anything else is refused in plain words.
  expect(await frame.evaluate(() => (window as unknown as { kit: { read: (what: string) => Promise<unknown> } }).kit.read('thats'))).toEqual({ from: 'thats', items: [] })
  expect(await frame.evaluate(() => (window as unknown as { kit: { read: (what: string) => Promise<unknown> } }).kit.read('notes').catch((error: Error) => error.message))).toBe(`This kit's manifest doesn't ask to read "notes".`)
  expect(
    await frame.evaluate(() =>
      (window as unknown as { kit: { store: { set: (c: string, id: string, v: unknown) => Promise<unknown> } } }).kit.store.set('notes', 'x', 1).catch((error: Error) => error.message),
    ),
  ).toBe('This kit has no "notes" collection in its manifest.')

  // Its store is with the project, and the count is there after a restart.
  await page.waitForTimeout(800)
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
  const again = await start(own)
  await expect((await kitFrame(again.page, 'counter')).locator('#n')).toHaveText('2')
  await quit(again.app)
  await rm(own, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

// The milestone: a learner builds a deck from their own that.s, reviews it,
// and moves themselves from Beginner on to Intermediate.
test('build a deck from that.s, review it, and move on a stage', async () => {
  const own = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  await writeFile(join(own, 'Lectura.md'), '# Lectura\n\nEn la cocina hay **la mesa** y dos sillas.\n')
  const { app, page } = await start(own, ['Lectura.md'])
  await page.getByLabel('Project name').fill('Spanish')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const reading = page.locator('.sheet[data-kind="paper"]')
  await reading.locator('.doc-section strong').evaluate((element) => getSelection()?.selectAllChildren(element))
  await page.keyboard.press(`${mod}+Period`)
  await expect(page.locator('.that-tray .that-chip')).toHaveCount(1)
  await page.evaluate(() => getSelection()?.removeAllRanges())

  const addSheet = async (name: string): Promise<void> => {
    await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
    await page.locator('.add-menu button', { hasText: 'Learning kit' }).click()
    await page.getByRole('menu', { name: 'Learning kits' }).getByRole('menuitem', { name }).click()
  }
  await addSheet('Vocabulary')
  await page.getByRole('dialog', { name: 'Allow Language' }).getByRole('button', { name: 'Allow' }).click()

  // The that. waits in the deck; one click puts its words in, and the agent suggests a meaning in pencil.
  const deck = await kitFrame(page, 'language', 'deck')
  await expect(deck.locator('#thats .that')).toHaveText(['la mesa'])
  await expect(deck.locator('#thats .from')).toHaveText(['Lectura, §1'])
  await deck.getByRole('button', { name: 'Use "la mesa"' }).click()
  await expect(deck.locator('#front')).toHaveValue('la mesa')
  await deck.getByRole('button', { name: 'Suggest' }).click()
  const suggestion = deck.getByRole('status', { name: 'Suggested meaning' })
  await expect(suggestion.locator('.said')).toHaveText('the table')
  await expect(deck.locator('#back')).toHaveValue('')
  // Esc dismisses it; asked again, Tab keeps it.
  await deck.locator('#back').press('Escape')
  await expect(suggestion).toBeHidden()
  await deck.getByRole('button', { name: 'Suggest' }).click()
  await expect(suggestion.locator('.said')).toHaveText('the table')
  await deck.locator('#back').press('Tab')
  await expect(suggestion).toBeHidden()
  await expect(deck.locator('#back')).toHaveValue('the table')
  await deck.getByRole('button', { name: 'Add to deck' }).click()
  await expect(deck.locator('#cards .front')).toHaveText(['la mesa'])
  await expect(deck.locator('#thats .that')).toHaveCount(0)

  // Review: the new card, its meaning, Good; then nothing is due.
  await addSheet('Review')
  const review = await kitFrame(page, 'language', 'review')
  await expect(review.locator('#count')).toHaveText('1 card to review')
  await expect(review.locator('#word')).toHaveText('la mesa')
  await expect(review.locator('#source')).toHaveText('Lectura, §1')
  await review.getByRole('button', { name: 'Show meaning' }).click()
  await expect(review.locator('#meaning')).toHaveText('the table')
  await review.getByRole('button', { name: 'Good' }).click()
  await expect(review.locator('#count')).toHaveText('Nothing due. Come back later.')
  // The deck hears of the review: the card is due tomorrow.
  await expect(deck.locator('#cards .when')).toHaveText(['tomorrow'])

  // Stages: the numbers, and only the learner moves on.
  await addSheet('Stages')
  const stages = await kitFrame(page, 'language', 'stages')
  await expect(stages.locator('[aria-current="step"] h2')).toHaveText('Beginner')
  await expect(stages.getByLabel('Your numbers')).toContainText('1in the deck')
  await stages.getByRole('button', { name: 'Move to Intermediate' }).click()
  await expect(stages.locator('[aria-current="step"] h2')).toHaveText('Intermediate')

  await page.waitForTimeout(800)
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
  const again = await start(own, ['Lectura.md'])
  await expect((await kitFrame(again.page, 'language', 'stages')).locator('[aria-current="step"] h2')).toHaveText('Intermediate')
  await expect((await kitFrame(again.page, 'language', 'deck')).locator('#cards .back')).toHaveText(['· the table'])
  await quit(again.app)
  await rm(own, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
