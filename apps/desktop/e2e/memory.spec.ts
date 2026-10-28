// The memory engine: kept days become pieces, and a line joins pieces from
// different days. The scripted model makes one piece per capture.
// Run `pnpm build` first.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { quit, start } from './app.js'

let home: string

function day(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const today = new Date()
// The calendar day before, not 24 hours back: a day can be 25 hours long.
const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, today.getHours(), today.getMinutes())

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  const kept = join(home, 'Carrel', 'Memory', 'kept')
  await mkdir(kept, { recursive: true })
  const capture = (at: Date, title: string, text: string) => ({ id: title, key: `page:${title}`, at: at.toISOString(), kind: 'page', from: 'keep', title, text, url: `https://example.com/${encodeURIComponent(title)}` })
  await writeFile(join(kept, `${day(yesterday)}.jsonl`), `${JSON.stringify(capture(yesterday, 'Paged attention', 'Paged attention keeps the KV cache in fixed size blocks, so serving wastes little memory.'))}\n`)
  await writeFile(join(kept, `${day(today)}.jsonl`), `${JSON.stringify(capture(today, 'Prefix caching', 'Prefix caching reuses KV cache blocks for a shared prompt, so serving skips work.'))}\n`)
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('Make pieces now turns kept days into pieces and draws a line between days', async () => {
  const { app, page } = await start(home)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'memory-settings'))
  const settings = page.getByRole('dialog', { name: 'Reading trail and memory' })
  await settings.getByRole('button', { name: 'Make pieces now' }).click()
  await expect(settings.getByRole('status')).toHaveText('Made 2 pieces and drew 1 line.')

  const memory = join(home, 'Carrel', 'Memory')
  const older = JSON.parse(await readFile(join(memory, 'pieces', `${day(yesterday)}.json`), 'utf8')) as { pieces: Array<{ id: string; title: string }> }
  const newer = JSON.parse(await readFile(join(memory, 'pieces', `${day(today)}.json`), 'utf8')) as { pieces: Array<{ id: string; title: string }> }
  expect(older.pieces.map((piece) => piece.title)).toEqual(['Paged attention'])
  expect(newer.pieces.map((piece) => piece.title)).toEqual(['Prefix caching'])
  const { lines } = JSON.parse(await readFile(join(memory, 'lines.json'), 'utf8')) as { lines: Array<{ from: string; to: string; relation: string }> }
  expect(lines).toMatchObject([{ from: newer.pieces[0]!.id, to: older.pieces[0]!.id, relation: 'same idea' }])

  // Nothing is made twice.
  await settings.getByRole('button', { name: 'Make pieces now' }).click()
  await expect(settings.getByRole('status')).toHaveText('Nothing new to make pieces from.')
  await quit(app)
})
