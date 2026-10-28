// Capture: chats are kept on their own, Keep saves what you choose with a
// reason, and a ChatGPT export is kept once.
// Run `pnpm build` first.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { quit, start } from './app.js'

let home: string
const SESSION = '0b5c9f3e-1d2a-4b6c-8e7f-9a0b1c2d3e4f'

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  // A tnega session from this morning, in the tnega home the app reads under CARREL_HOME.
  const now = Date.now()
  const sessions = join(home, '.tnega', 'sessions', 'workspace')
  await mkdir(sessions, { recursive: true })
  const events = [
    { type: 'meta', payload: { title: 'Inference costs' } },
    { type: 'user/message', payload: { content: 'What is prefix caching?' } },
    { type: 'assistant/message', payload: { content: 'Reusing KV blocks for a shared prompt.' } },
  ]
  await writeFile(join(sessions, `${SESSION}.jsonl`), events.map((event, index) => JSON.stringify({ id: `e${index}`, seq: index + 1, ts: now, ...event })).join('\n') + '\n')
  const exported = [
    {
      title: 'LRU cache',
      conversation_id: 'conv-1',
      create_time: now / 1000,
      current_node: 'b',
      mapping: {
        a: { parent: null, message: { author: { role: 'user' }, create_time: now / 1000, content: { parts: ['How do I build an LRU cache?'] } } },
        b: { parent: 'a', message: { author: { role: 'assistant' }, create_time: now / 1000, content: { parts: ['A hash map and a linked list.'] } } },
      },
    },
  ]
  await writeFile(join(home, 'conversations.json'), JSON.stringify(exported))
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

async function keptToday(): Promise<Array<{ kind: string; from: string; title: string; text: string; reason?: string }>> {
  const dir = join(home, 'Carrel', 'Memory', 'kept')
  const days = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith('.jsonl'))
  const lines = (await Promise.all(days.map((day) => readFile(join(dir, day), 'utf8')))).join('').split('\n')
  return lines.filter(Boolean).map((line) => JSON.parse(line) as { kind: string; from: string; title: string; text: string; reason?: string })
}

test('chats are kept, Keep saves copied words with a reason, and an export is imported once', async () => {
  process.env.CARREL_CHATGPT_EXPORT = join(home, 'conversations.json')
  const { app, page } = await start(home)
  delete process.env.CARREL_CHATGPT_EXPORT

  // The tnega session is kept within a few seconds of starting, without asking.
  await expect.poll(async () => (await keptToday()).map((capture) => `${capture.from}: ${capture.title}`)).toContain('tnega: Inference costs')

  // Keep: copied words, with a reason.
  await app.evaluate(({ clipboard }) => clipboard.writeText('Prefix caching reuses KV blocks across requests.'))
  const opened = app.waitForEvent('window')
  await page.evaluate(() => window.carrel.memory.openKeep())
  const keep = await opened
  const form = keep.getByRole('form', { name: 'Keep' })
  await expect(form).toBeVisible()
  await expect(keep.getByRole('radio', { name: /Copied text/ })).toBeChecked()
  await keep.getByLabel('Why keep it').fill('for the inference notes')
  await keep.getByLabel('Why keep it').press('Enter')
  await expect(keep.getByRole('button', { name: 'Kept' })).toBeVisible()
  await expect
    .poll(async () => (await keptToday()).find((capture) => capture.from === 'keep'))
    .toMatchObject({ kind: 'selection', title: 'Prefix caching reuses KV blocks across requests.', reason: 'for the inference notes' })

  // The ChatGPT import, from the menu bar: kept once, however often.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('keep'))?.webContents.send('menu:command', 'import-chatgpt'))
  const settings = page.getByRole('dialog', { name: 'Reading trail and memory' })
  await expect(settings.getByRole('status')).toHaveText('Kept 1 day of chats from 1 conversation.')
  await settings.getByRole('button', { name: 'Import ChatGPT export…' }).click()
  await expect(settings.getByRole('status')).toHaveText('The 1 conversation was kept before.')
  expect((await keptToday()).filter((capture) => capture.from === 'chatgpt').map((capture) => capture.title)).toEqual(['LRU cache'])

  // The reading trail: a site added here is kept in memory's settings.
  await settings.getByLabel('Add a site').fill('https://www.arxiv.org/abs/1')
  await settings.getByRole('button', { name: 'Add site' }).click()
  await expect(settings.getByRole('listitem')).toHaveText(['arxiv.org×'])
  await expect.poll(async () => JSON.parse(await readFile(join(home, '.carrel', 'memory', 'settings.json'), 'utf8').catch(() => '{}')) as unknown).toEqual({ trail: ['arxiv.org'], eveningHour: 21 })
  await quit(app)
})
