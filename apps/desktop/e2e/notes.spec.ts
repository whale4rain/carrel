// Notes on their own page: the sidebar lists them as a tree of folders; a
// note is filed as a Markdown file named by its title; dragging files it in
// another folder; Put on desk lays it beside your sources. [[Links]] join
// notes, and a note's margin lists who links to it and who only names it.
// Run `pnpm build` first.
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { quit, start } from './app.js'

let home: string

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('write notes on their own page and file them in folders', async () => {
  const { app, page } = await start(home)
  await page.getByLabel('Project name').fill('Notes home')
  await page.getByRole('button', { name: 'Create project' }).click()
  const tree = page.locator('.sidebar [aria-label="Notes"]')
  const notesDir = join(home, 'Carrel', 'Notes home', 'notes')

  // A folder, and a note made in it: the note opens on its own page, ready to write.
  await tree.getByRole('button', { name: '+ Folder' }).click()
  await page.getByLabel('New folder name').fill('Micro')
  await page.getByLabel('New folder name').press('Enter')
  await tree.locator('.tree-folder-row', { hasText: 'Micro' }).hover()
  await tree.getByRole('button', { name: 'New note in Micro' }).click()
  const editor = page.locator('.note-page .ProseMirror')
  await expect(editor).toBeFocused()
  await page.keyboard.type('Elasticity')
  await expect(page.locator('.topbar .desk-name')).toHaveText('Elasticity')
  await expect(tree.locator('.row.note[aria-current="page"]')).toHaveText('Elasticity')
  await expect.poll(() => readdir(join(notesDir, 'Micro'))).toEqual(['Elasticity.md'])

  // Headings show in the margin's outline.
  await page.keyboard.press('Enter')
  await page.keyboard.type('## Why it matters')
  await expect(page.locator('.note-outline li')).toHaveText(['Elasticity', 'Why it matters'])

  // A second folder; drag the note into it.
  await tree.getByRole('button', { name: '+ Folder' }).click()
  await page.getByLabel('New folder name').fill('Exam')
  await page.getByLabel('New folder name').press('Enter')
  await tree.locator('.row.note', { hasText: 'Elasticity' }).dragTo(tree.locator('.tree-folder-row', { hasText: 'Exam' }))
  await expect(tree.getByRole('group', { name: 'Exam' }).locator('.row.note')).toHaveText(['Elasticity'])
  await expect.poll(() => readdir(join(notesDir, 'Exam'))).toEqual(['Elasticity.md'])
  await expect(page.locator('.note-page-path')).toContainText('Exam')

  // Rename a folder by double-clicking it.
  await tree.locator('.row.folder', { hasText: 'Exam' }).dblclick()
  await page.getByLabel('Folder name').fill('Exam prep')
  await page.getByLabel('Folder name').press('Enter')
  await expect(tree.getByRole('group', { name: 'Exam prep' }).locator('.row.note')).toHaveText(['Elasticity'])
  await expect.poll(async () => (await readdir(notesDir)).sort()).toEqual(['Exam prep', 'Micro'])

  // Put on desk: the desk comes back with the note on it.
  await page.getByRole('button', { name: 'Put on desk' }).click()
  await expect(page.locator('.note-page')).toHaveCount(0)
  await expect(page.locator('.sheet[data-kind="note"] .ProseMirror h1')).toHaveText('Elasticity')

  // Clicking the note in the tree opens its page again.
  await tree.locator('.row.note', { hasText: 'Elasticity' }).click()
  await expect(page.locator('.note-page .ProseMirror h1')).toHaveText('Elasticity')
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
})

test('link notes with [[ and see who links back', async () => {
  const { app, page } = await start(home)
  const tree = page.locator('.sidebar [aria-label="Notes"]')
  const editor = page.locator('.note-page .ProseMirror')
  const newNote = async (title: string, body: string): Promise<void> => {
    await tree.getByRole('button', { name: '+ New note' }).click()
    await expect(editor).toBeFocused()
    await page.keyboard.type(title)
    await page.keyboard.press('Enter')
    await page.keyboard.type(body)
    await expect(tree.locator('.row.note', { hasText: title })).toHaveCount(1)
  }
  await newNote('Consumer surplus', 'What buyers gain.')
  await newNote('Exam plan', 'Mentions consumer surplus without a link. Then ')

  // [[ offers notes by name; Enter links the one picked.
  await page.keyboard.type('[[cons')
  const suggest = page.locator('.link-suggest')
  await expect(suggest.getByRole('option').first()).toHaveText(/Consumer surplus/)
  await page.keyboard.press('Enter')
  await expect(suggest).toHaveCount(0)
  await expect(editor.locator('.note-link')).toHaveText('Consumer surplus')
  // A whole [[name]] typed makes a link too; to a note that isn't there yet, it looks faint.
  await page.keyboard.type('and [[Tax incidence]]')
  await expect(editor.locator('.note-link.unresolved')).toHaveText('Tax incidence')

  // Clicking a link opens its note, whose margin lists the note linking to it.
  await editor.locator('.note-link', { hasText: 'Consumer surplus' }).click()
  await expect(page.locator('.topbar .desk-name')).toHaveText('Consumer surplus')
  await expect(page.locator('[aria-label="Linked here"] li')).toHaveText([/Exam plan.*Consumer surplus/])

  // Elasticity names "consumer surplus" without linking; Link makes it a link.
  await newNote('Elasticity notes', 'Ties into consumer surplus too.')
  await tree.locator('.row.note', { hasText: 'Consumer surplus' }).click()
  const unlinked = page.locator('[aria-label="Mentioned, not linked"] li')
  await expect(unlinked).toHaveText([/Elasticity notes/])
  await unlinked.getByRole('button', { name: 'Link' }).click()
  await expect(page.locator('[aria-label="Linked here"] li')).toHaveCount(2)
  await expect(page.locator('[aria-label="Mentioned, not linked"]')).toHaveCount(0)

  // Renaming a note keeps the links to it.
  await editor.locator('h1').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' (CS)')
  await expect(tree.locator('.row.note', { hasText: 'Consumer surplus (CS)' })).toHaveCount(1)
  await tree.locator('.row.note', { hasText: 'Exam plan' }).click()
  await expect(editor.locator('.note-link').first()).toHaveText('Consumer surplus (CS)')

  // A link to a missing note makes it when clicked.
  await editor.locator('.note-link', { hasText: 'Tax incidence' }).click()
  await expect(page.locator('.topbar .desk-name')).toHaveText('Tax incidence')
  await expect(page.locator('[aria-label="Linked here"] li')).toHaveText([/Exam plan/])
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
})
