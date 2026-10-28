// The map: pieces by day with lines between days, a piece's lines listed
// beside it with × to remove one for good, ranges, and search by cues.
// Run `pnpm build` first.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { quit, start } from './app.js'

let home: string

function dayOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function ago(n: number): string {
  const now = new Date()
  return dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, 12))
}

// What two weeks of reading and asking might leave, like the mockup.
const PIECES: Array<[id: string, back: number, group: string, label: string, title: string, url?: string]> = [
  ['attention', 13, 'Agents & inference', 'Video', 'How attention compares every token', 'https://www.youtube.com/watch?v=attn'],
  ['kv-grows', 8, 'Agents & inference', 'Blog', 'KV cache grows with sequence length', 'https://blog.example.com/kv'],
  ['paged', 4, 'Agents & inference', 'Paper', 'Paged attention: KV in fixed-size blocks', 'https://arxiv.org/abs/2309.06180'],
  ['plugins', 5, 'Agents & inference', 'Code', 'Plugin load order follows the inject graph'],
  ['stop-rule', 2, 'Agents & inference', 'Chat', 'An agent loop needs a stop rule, not a step cap'],
  ['prefix', 0, 'Agents & inference', 'Blog', 'Prefix caching reuses KV blocks', 'https://blog.example.com/prefix'],
  ['vm-pages', 10, 'Systems & backend', 'X post', 'How OS virtual memory pages work', 'https://x.com/someone/status/1'],
  ['locks', 7, 'Systems & backend', 'Blog', 'Postgres advisory locks for job queues'],
  ['backoff', 9, 'Systems & backend', 'X post', 'Retry with backoff and jitter'],
  ['idempotent', 6, 'Systems & backend', 'Chat', 'Tool calls must be safe to repeat'],
  ['lru', 12, 'Algorithms', 'LeetCode 146', 'LRU cache: hash map + linked list', 'https://leetcode.com/problems/lru-cache/'],
  ['topo', 11, 'Algorithms', 'LeetCode 207', 'Course schedule: topological sort'],
  ['rust', 1, 'Loose ends', 'X post', 'Rust ownership, first look'],
  ['old', 40, 'Algorithms', 'Chat', 'Binary search on the answer'],
]
const LINES: Array<[from: string, to: string, relation: string, back: number]> = [
  ['prefix', 'paged', 'builds on', 0],
  ['prefix', 'kv-grows', 'why it matters', 0],
  ['prefix', 'lru', 'same idea', 0],
  ['kv-grows', 'attention', 'builds on', 8],
  ['paged', 'vm-pages', 'same idea', 4],
  ['paged', 'kv-grows', 'builds on', 4],
  ['idempotent', 'backoff', 'why it matters', 6],
  ['stop-rule', 'idempotent', 'builds on', 2],
  ['locks', 'backoff', 'same idea', 7],
  ['topo', 'old', 'builds on', 11],
]

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-e2e-'))
  const memory = join(home, 'Carrel', 'Memory')
  await mkdir(join(memory, 'pieces'), { recursive: true })
  await mkdir(join(memory, 'kept'), { recursive: true })
  const byDay = new Map<string, unknown[]>()
  for (const [id, back, group, label, title, url] of PIECES) {
    const day = ago(back)
    const at = new Date(`${day}T10:40:00`).toISOString()
    const piece = { id, day, title, body: `${title}, in a few plain words.`, group, source: { label, kind: label === 'Chat' ? 'chat' : 'page', from: label === 'Chat' ? 'tnega' : 'keep', title, ...(url ? { url } : {}), at }, captures: [], createdAt: at }
    byDay.set(day, [...(byDay.get(day) ?? []), piece])
  }
  for (const [day, pieces] of byDay) await writeFile(join(memory, 'pieces', `${day}.json`), JSON.stringify({ format: 1, day, pieces, distilled: {} }))
  const lines = LINES.map(([from, to, relation, back], n) => ({ id: `line-${n}`, from, to, relation, drawnOn: ago(back), drawnAt: new Date(`${ago(back)}T21:00:00`).toISOString() }))
  await writeFile(join(memory, 'lines.json'), JSON.stringify({ format: 1, lines }))
  // A page read on the trail and never made into a piece.
  const visit = { id: 'v1', key: 'visit:https://example.com/spec', at: new Date().toISOString(), kind: 'visit', from: 'trail', title: 'Speculative decoding explained', text: 'A small draft model guesses tokens that the big model checks in one pass.', url: 'https://example.com/spec' }
  await writeFile(join(memory, 'kept', `${ago(0)}.jsonl`), `${JSON.stringify(visit)}\n`)
})

test.afterAll(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

test('the map shows pieces by day, lists a piece’s lines, removes one for good, and finds by cues', async () => {
  const { app, page } = await start(home)
  await page.getByRole('button', { name: 'Map of what you learned' }).click()
  const map = page.getByRole('region', { name: 'Map', exact: true })
  await expect(map.getByRole('heading', { name: 'What you’ve learned' })).toBeVisible()
  await expect(map.getByRole('button', { name: /How attention compares every token/ })).toBeVisible()
  await expect(map.getByRole('button', { name: /Binary search on the answer/ })).toHaveCount(0)
  await expect(page.locator('.map-lines path')).toHaveCount(9)
  await expect(page.locator('.map-lines path[data-fresh]')).toHaveCount(3)

  // Today's piece is open beside the map, with its three new lines as text.
  const detail = page.getByRole('complementary', { name: 'Piece' })
  await expect(detail.getByRole('heading', { name: 'Prefix caching reuses KV blocks' })).toBeVisible()
  await expect(detail.getByText('from a blog you read at 10:40')).toBeVisible()
  await expect(detail.getByRole('heading', { name: '3 new lines' })).toBeVisible()
  await expect(detail.getByRole('button', { name: /builds on · .*Paged attention/ })).toBeVisible()
  if (process.env.CARREL_MAP_SHOT) {
    // A picture at the mockup's size, for review.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000))
    await page.waitForTimeout(500)
    await page.screenshot({ path: process.env.CARREL_MAP_SHOT })
  }

  // × removes a line; it is kept as removed, and as a correction.
  await detail.getByRole('button', { name: 'Remove the line to LRU cache: hash map + linked list' }).click()
  await expect(detail.getByRole('heading', { name: '2 new lines' })).toBeVisible()
  await expect(page.locator('.map-lines path')).toHaveCount(8)
  const memory = join(home, 'Carrel', 'Memory')
  const { lines } = JSON.parse(await readFile(join(memory, 'lines.json'), 'utf8')) as { lines: Array<{ to: string; removedAt?: string }> }
  expect(lines.find((line) => line.to === 'lru')?.removedAt).toBeTruthy()
  expect(await readFile(join(memory, 'corrections.jsonl'), 'utf8')).toContain('"type":"line.removed"')

  // Seen from the other end, a line reads the other way.
  await detail.getByRole('button', { name: /^builds on · .*Paged attention/ }).click()
  await expect(detail.getByRole('button', { name: /built on by · Today.*Prefix caching/ })).toBeVisible()

  // All shows older days too.
  await map.getByRole('group', { name: 'Range' }).getByRole('button', { name: 'All' }).click()
  await expect(map.getByRole('button', { name: /Binary search on the answer/ })).toBeVisible()
  await map.getByRole('group', { name: 'Range' }).getByRole('button', { name: '2 weeks' }).click()

  // Search by cues finds pieces, and pages never made into pieces.
  const search = map.getByLabel('Find anything')
  await search.fill('that leetcode lru cache')
  await map.getByRole('option').filter({ hasText: 'LRU cache: hash map' }).getByRole('button').click()
  await expect(detail.getByRole('heading', { name: 'LRU cache: hash map + linked list' })).toBeVisible()
  await search.fill('speculative decoding')
  await map.getByRole('option').filter({ hasText: 'not a piece' }).getByRole('button').click()
  await expect(page.getByRole('complementary', { name: 'Found' }).getByRole('heading', { name: 'Speculative decoding explained' })).toBeVisible()

  // Opening a desk leaves the map.
  await page.getByRole('button', { name: 'Map of what you learned' }).click()
  await expect(map).toBeVisible()
  await quit(app)
})
