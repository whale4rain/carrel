// Notes on their own page: the sidebar lists them as a tree of folders; a
// note is filed as a Markdown file named by its title; dragging files it in
// another folder; Put on desk lays it beside your sources. [[Links]] join
// notes, and a note's margin lists who links to it and who only names it.
// Run `pnpm build` first.
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { mod, quit, start } from './app.js'

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

test('open a note by name, pin it, and write today’s note', async () => {
  const { app, page } = await start(home)
  const pinned = page.locator('.sidebar [aria-label="Pinned"]')

  // ⌘O / Ctrl+O finds a note by part of its name; Enter opens it on its page.
  await page.keyboard.press(`${mod}+KeyO`)
  const open = page.getByRole('dialog', { name: 'Open a note' })
  await open.getByLabel('Note name').fill('plan')
  await expect(open.getByRole('option').first()).toHaveText(/Exam plan/)
  await page.keyboard.press('Enter')
  await expect(open).toHaveCount(0)
  await expect(page.locator('.topbar .desk-name')).toHaveText('Exam plan')

  // A name no note has makes a new note with it.
  await page.keyboard.press(`${mod}+KeyO`)
  await open.getByLabel('Note name').fill('Opportunity cost')
  await expect(open.getByRole('option').last()).toHaveText('+New note “Opportunity cost”')
  await page.keyboard.press('Shift+Enter')
  await expect(page.locator('.note-page .ProseMirror h1')).toHaveText('Opportunity cost')

  // Pin keeps a note at the top of the sidebar.
  await page.getByRole('button', { name: 'Pin', exact: true }).click()
  await expect(pinned.locator('.row.note')).toHaveText(['Opportunity cost'])
  await page.getByRole('button', { name: 'Unpin' }).click()
  await expect(pinned.locator('.row.note')).toHaveCount(0)

  // Today's note (⌘⇧D / Ctrl+Shift+D) is made once, in Daily, named by the date.
  await page.keyboard.press(`${mod}+Shift+KeyD`)
  const today = await page.evaluate(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  await expect(page.locator('.note-page .ProseMirror h1')).toHaveText(today)
  await expect(page.locator('.note-page-path')).toContainText('Daily')
  await pinned.getByRole('button', { name: /Today’s note/ }).click()
  await expect(page.locator('.sidebar [aria-label="Notes"]').getByRole('group', { name: 'Daily' }).locator('.row.note')).toHaveText([today])
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
})

test('give a note properties under its title', async () => {
  const { app, page } = await start(home)
  const tree = page.locator('.sidebar [aria-label="Notes"]')
  await tree.getByRole('button', { name: '+ New note' }).click()
  const editor = page.locator('.note-page .ProseMirror')
  await expect(editor).toBeFocused()
  await page.keyboard.type('Supply shocks')
  await expect(tree.locator('.row.note', { hasText: 'Supply shocks' })).toHaveCount(1)
  const props = page.getByLabel('Properties')

  // A text property: name it, pick its kind, then type its value.
  await props.getByRole('button', { name: '+ Add a property' }).click()
  await props.getByLabel('Property name').fill('status')
  await props.getByRole('button', { name: 'Add', exact: true }).click()
  await props.getByLabel('status', { exact: true }).fill('Learning')
  await props.getByLabel('status', { exact: true }).press('Enter')
  // A list: tags, which also tag the note.
  await props.getByRole('button', { name: '+ Add a property' }).click()
  await props.getByLabel('Property name').fill('tags')
  await props.getByLabel('Property name').press('Enter')
  await props.getByLabel('Add to tags').fill('exam')
  await props.getByLabel('Add to tags').press('Enter')
  await expect(props.locator('.note-prop-chip')).toHaveText(['exam×'])
  await expect(page.locator('.sidebar .tag', { hasText: '#exam' })).toHaveCount(1)
  // A checkbox.
  await props.getByRole('button', { name: '+ Add a property' }).click()
  await props.getByLabel('Property name').fill('done')
  await props.getByLabel('Kind').selectOption('checkbox')
  await props.getByRole('button', { name: 'Add', exact: true }).click()
  await props.getByLabel('done', { exact: true }).check()

  // They live in the note's header, and survive more writing.
  await editor.locator('h1').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Oil prices.')
  const file = join(home, 'Carrel', 'Notes home', 'notes', 'Supply shocks.md')
  await expect.poll(() => readFile(file, 'utf8')).toMatch(/status: Learning\ntags:\n {2}- exam\ndone: true\n---\n# Supply shocks\n\nOil prices\.\n$/)

  // Remove one.
  await props.locator('.note-prop', { hasText: 'done' }).hover()
  await props.getByRole('button', { name: 'Remove done' }).click()
  await expect(props.locator('.note-prop')).toHaveCount(2)
  await expect.poll(() => readFile(file, 'utf8')).not.toContain('done:')
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
})

test('see notes in a saved view, as a table or as cards', async () => {
  let { app, page } = await start(home)
  const views = page.locator('.sidebar [aria-label="Views"]')
  await views.getByRole('button', { name: '+ New view' }).click()
  await page.getByLabel('New view name').fill('Studying')
  await page.getByLabel('New view name').press('Enter')
  const view = page.getByRole('main', { name: 'View: Studying' })
  await expect(view.locator('.view-title', { hasText: 'Supply shocks' })).toHaveCount(1)

  // Keep the notes whose status is Learning, and show their status.
  await view.getByRole('button', { name: '+ Filter' }).click()
  await view.getByLabel('Filter field').selectOption('property:status')
  await view.getByLabel('Filter rule').selectOption('is')
  await view.getByLabel('Filter value').fill('Learning')
  await view.getByRole('button', { name: 'Add filter' }).click()
  await expect(view.locator('.view-title')).toHaveText(['Supply shocks'])
  await view.getByRole('button', { name: 'Fields' }).click()
  await view.getByRole('dialog', { name: 'Fields shown' }).getByRole('checkbox', { name: 'status' }).check()
  await view.getByRole('button', { name: 'Fields' }).click()
  await expect(view.locator('th')).toHaveText(['Title', 'Folder', 'Tags', 'Edited ↓', 'status'])

  // A new note made here gets what the filter asks for.
  await view.getByRole('button', { name: '+ New note in this view' }).click()
  await expect(page.locator('.note-page .ProseMirror')).toBeFocused()
  await page.keyboard.type('Price floors')
  const file = join(home, 'Carrel', 'Notes home', 'notes', 'Price floors.md')
  await expect.poll(() => readFile(file, 'utf8').catch(() => '')).toContain('status: Learning')
  await views.getByRole('button', { name: 'Studying' }).click()
  await expect(view.locator('.view-title')).toHaveText(['Price floors', 'Supply shocks'])

  // Change a status in its cell: the note leaves the view, and its file says so.
  await view.getByLabel('status of Price floors').fill('Known')
  await view.getByLabel('status of Price floors').press('Enter')
  await expect(view.locator('.view-title')).toHaveText(['Supply shocks'])
  await expect.poll(() => readFile(file, 'utf8')).toContain('status: Known')

  // As cards, and still there after a restart.
  await view.getByRole('button', { name: 'Cards' }).click()
  await expect(view.locator('.view-card')).toHaveCount(1)
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
  ;({ app, page } = await start(home))
  await page.locator('.sidebar [aria-label="Views"]').getByRole('button', { name: 'Studying' }).click()
  const again = page.getByRole('main', { name: 'View: Studying' })
  await expect(again.locator('.view-card-title')).toHaveText(['Supply shocks'])
  await expect(again.locator('.view-chip')).toContainText('status is Learning')
  await page.evaluate(() => window.carrel.workspace.state())
  await quit(app)
})
