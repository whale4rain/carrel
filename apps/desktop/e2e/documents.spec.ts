// Files read as text. A Markdown file: its sections in Contents, a jump by
// section number, a bookmark, a that. on its words, and search finding them.
// An EPUB: its chapters as sections, named by the book's contents.
// Run `pnpm build` first.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { tinyEpub } from '../scripts/tiny-epub.mjs'
import { mod, quit, start } from './app.js'

let home: string

const NOTES = `# Field notes

A short guide to reading slowly.

## Attention

Reading slowly means **one passage** at a time, with the margin open.

- Look for the claim.
- Look for the reason.

## Memory

Spaced review keeps what you read. See [the guide](https://example.com/guide).

| Interval | Use |
| --- | --- |
| 1 day | First look |
| 7 days | Second look |

## Agency

\`\`\`
plan → read → write
\`\`\`

The fieldwork ends with a written note in your own words.
`

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  await writeFile(join(home, 'Field notes.md'), NOTES)
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('read a Markdown file by sections', async () => {
  const { app, page } = await start(home, ['Field notes.md'])
  await page.getByLabel('Project name').fill('Documents')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const sheet = page.locator('.sheet[data-kind="paper"]')
  await expect(sheet.locator('.doc-section')).toHaveCount(4)
  await expect(sheet.locator('.doc-section[data-page="2"] h3')).toHaveText('Attention')
  await expect(sheet.locator('.doc-section[data-page="3"] td').first()).toHaveText('1 day')

  // Contents lists the sections; one goes there.
  await sheet.getByRole('button', { name: 'Contents' }).click()
  const contents = sheet.getByRole('navigation', { name: 'Contents' })
  await expect(contents.locator('ul').last().locator('li button')).toHaveText(['Field notes1', 'Attention2', 'Memory3', 'Agency4'])
  await contents.getByRole('button', { name: /Memory/ }).click()
  const jump = sheet.getByLabel('Go to section')
  await expect(jump).toHaveValue('3')

  // The ribbon keeps a section, named by its heading.
  await sheet.getByRole('button', { name: 'Bookmark section 3' }).click()
  await expect(sheet.locator('.doc-section[data-page="3"] .pdf-ribbon')).toHaveCount(1)
  await sheet.getByRole('button', { name: 'Contents' }).click()
  await expect(sheet.getByRole('list', { name: 'Bookmarks' }).locator('li > button:first-child')).toHaveText(['Memory3'])
  await sheet.getByRole('button', { name: 'Contents' }).click()

  // that.: select the bold words and press ⌘. (Ctrl+.); the chip names the section.
  await jump.click()
  await page.keyboard.type('2')
  await page.keyboard.press('Enter')
  await expect(jump).toHaveValue('2')
  await sheet.locator('.doc-section[data-page="2"] strong').evaluate((element) => getSelection()?.selectAllChildren(element))
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('one passage')
  await page.keyboard.press(`${mod}+Period`)
  await expect(page.locator('.that-tray .that-chip', { hasText: '§2' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.carrel.workspace.thats().then((thats) => thats.map((that) => `${that.label} ${that.text}`)))).toEqual(['§2 one passage'])
  // Its band sits under the words.
  await expect.poll(() => page.evaluate(() => [...(CSS.highlights.get('that') ?? [])].map((range) => (range as Range).toString()))).toEqual(['one passage'])

  // Search reads the sections too.
  await page.keyboard.press(`${mod}+KeyK`)
  await page.keyboard.type('fieldwork')
  const hit = page.locator('.search-hit', { hasText: 'fieldwork' })
  await expect(hit.locator('.search-hit-page')).toHaveText('§ 4')
  await hit.click()
  await expect(jump).toHaveValue('4')

  // After a restart it opens where you were reading.
  await page.waitForTimeout(800)
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
  const again = await start(home, ['Field notes.md'])
  await expect(again.page.locator('.sheet[data-kind="paper"]').getByLabel('Go to section')).toHaveValue('4')
  await quit(again.app)
})

test('read an EPUB by chapters', async () => {
  // A home of its own, so a new project starts.
  const own = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  await writeFile(
    join(own, 'Walden.epub'),
    tinyEpub('Walden', [
      { title: 'Economy', paragraphs: ['When I wrote the following pages, I lived alone, in the woods.'] },
      { title: 'Where I Lived', paragraphs: ['At a certain season of our life we are accustomed to consider every spot as the possible site of a house.'] },
      { title: 'Reading', paragraphs: ['Books are the treasured wealth of the world.'] },
    ]),
  )
  const { app, page } = await start(own, ['Walden.epub'])
  await page.getByLabel('Project name').fill('Walden')
  await page.getByRole('button', { name: 'Create project' }).click()
  await page.locator('.desk-tools button', { hasText: '+ Add' }).click()
  await page.locator('.add-menu button', { hasText: 'Book or paper' }).click()
  const sheet = page.locator('.sheet[data-kind="book"]')
  await expect(sheet.locator('.doc-section')).toHaveCount(3)
  await sheet.getByRole('button', { name: 'Contents' }).click()
  const contents = sheet.getByRole('navigation', { name: 'Contents' })
  await expect(contents.locator('ul').last().locator('li button')).toHaveText(['Economy1', 'Where I Lived2', 'Reading3'])
  await contents.getByRole('button', { name: /Reading/ }).click()
  await expect(sheet.getByLabel('Go to section')).toHaveValue('3')
  await expect(sheet.locator('.doc-section[data-page="3"] p')).toHaveText('Books are the treasured wealth of the world.')
  await quit(app)
  await rm(own, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})
