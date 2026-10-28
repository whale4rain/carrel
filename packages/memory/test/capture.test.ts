import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { carrelRoots } from '@carrel/core'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addDays, ChatSync, chatCaptures, dayLabel, dayOf, daysBetween, Kept, memoryPaths, onTrail, readChatGptExport, readSettings, readTnegaSession, siteOf, visitKey, writeSettings, type MemoryPaths } from '../src/index.js'

let home: string
let paths: MemoryPaths
let kept: Kept

// Local times, so days don't move with the time zone the tests run in.
const OCT_15_9AM = new Date(2026, 9, 15, 9, 0).getTime()
const OCT_15_8PM = new Date(2026, 9, 15, 20, 0).getTime()
const OCT_16_10AM = new Date(2026, 9, 16, 10, 0).getTime()

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-memory-'))
  paths = memoryPaths(carrelRoots(home))
  kept = new Kept(paths, () => new Date(OCT_15_9AM))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('days', () => {
  it('names local days and counts between them', () => {
    expect(dayOf(OCT_15_8PM)).toBe('2026-10-15')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(daysBetween('2026-10-15', '2026-10-28')).toBe(13)
    expect(dayLabel('2026-10-15')).toBe('Oct 15')
  })
})

describe('Kept', () => {
  it('keeps captures in a JSON lines file per day, under ~/Carrel/Memory', async () => {
    await kept.add({ kind: 'page', from: 'keep', title: 'Prefix caching', text: 'KV blocks are reused.', url: 'https://example.com/prefix', reason: '  for the  inference notes ' })
    await kept.add({ kind: 'visit', from: 'trail', title: 'Paged attention', text: 'Blocks.', at: new Date(OCT_16_10AM).toISOString() })
    expect(await kept.days()).toEqual(['2026-10-15', '2026-10-16'])
    const day = await kept.day('2026-10-15')
    expect(day).toHaveLength(1)
    expect(day[0]).toMatchObject({ kind: 'page', title: 'Prefix caching', reason: 'for the inference notes' })
    expect(await readFile(join(home, 'Carrel', 'Memory', 'kept', '2026-10-15.jsonl'), 'utf8')).toContain('Prefix caching')
  })

  it('reads the latest capture of each key, and skips torn lines', async () => {
    await kept.add({ key: 'chat:tnega:a:2026-10-15', kind: 'chat', from: 'tnega', title: 'Caching', text: 'You: first' })
    await kept.add({ key: 'chat:tnega:a:2026-10-15', kind: 'chat', from: 'tnega', title: 'Caching', text: 'You: first\n\nAgent: second' })
    await appendFile(join(paths.kept, '2026-10-15.jsonl'), '{"torn":\n')
    const day = await kept.day('2026-10-15')
    expect(day.map((capture) => capture.text)).toEqual(['You: first\n\nAgent: second'])
  })

  it('keeps screenshots beside the day files', async () => {
    const name = await kept.saveImage(new Uint8Array([137, 80, 78, 71]))
    expect(await readFile(kept.imagePath(name))).toHaveLength(4)
    expect(() => kept.imagePath('../escape.png')).toThrow()
  })
})

const SESSION_ID = '0b5c9f3e-1d2a-4b6c-8e7f-9a0b1c2d3e4f'

function tnegaLog(events: Array<{ type: string; ts: number; payload: Record<string, unknown> }>): string {
  return events.map((event, index) => JSON.stringify({ id: `e${index}`, seq: index + 1, ...event })).join('\n') + '\n'
}

describe('chats', () => {
  it('reads a tnega session and makes a capture per day it ran on', () => {
    const conversation = readTnegaSession(
      SESSION_ID,
      tnegaLog([
        { type: 'meta', ts: OCT_15_9AM, payload: { title: 'New session' } },
        { type: 'user/message', ts: OCT_15_9AM, payload: { content: 'Why does the KV cache grow with sequence length?' } },
        { type: 'tool/call', ts: OCT_15_9AM, payload: { name: 'search' } },
        { type: 'assistant/message', ts: OCT_15_9AM + 1000, payload: { content: 'Every token keeps its keys and values.' } },
        { type: 'user/message', ts: OCT_16_10AM, payload: { content: 'And paged attention?' } },
      ]),
    )
    const captures = chatCaptures(conversation)
    expect(captures.map((capture) => capture.key)).toEqual([`chat:tnega:${SESSION_ID}:2026-10-15`, `chat:tnega:${SESSION_ID}:2026-10-16`])
    // A placeholder title gives way to the first question.
    expect(captures[0]).toMatchObject({ kind: 'chat', from: 'tnega', title: 'Why does the KV cache grow with sequence length?' })
    expect(captures[0]!.text).toBe('You: Why does the KV cache grow with sequence length?\n\nAgent: Every token keeps its keys and values.')
  })

  it('syncs tnega sessions and Carrel threads, keeping only what changed', async () => {
    const tnegaHome = join(home, '.tnega')
    const sessionFile = join(tnegaHome, 'sessions', 'abc123', `${SESSION_ID}.jsonl`)
    await mkdir(join(tnegaHome, 'sessions', 'abc123'), { recursive: true })
    await writeFile(sessionFile, tnegaLog([{ type: 'meta', ts: OCT_15_9AM, payload: { title: 'Inference costs' } }, { type: 'user/message', ts: OCT_15_9AM, payload: { content: 'What is prefix caching?' } }]))
    const threads = join(home, 'Carrel', 'Learn agents', 'threads')
    await mkdir(threads, { recursive: true })
    await writeFile(
      join(threads, 'project.jsonl'),
      [
        { id: '1', by: 'user', text: 'Tool calls must be safe to repeat?', createdAt: new Date(OCT_15_8PM).toISOString() },
        { id: '2', by: 'agent', text: '', error: 'No key', createdAt: new Date(OCT_15_8PM).toISOString() },
      ]
        .map((turn) => JSON.stringify(turn))
        .join('\n'),
    )
    const sync = new ChatSync(kept, { tnegaHome, content: join(home, 'Carrel'), cursorFile: join(paths.internal, 'chats.json') })
    expect(await sync.sync()).toBe(2)
    expect((await kept.day('2026-10-15')).map((capture) => `${capture.from}: ${capture.title}`).sort()).toEqual(['carrel: Tool calls must be safe to repeat?', 'tnega: Inference costs'])
    // Nothing changed: nothing is kept again.
    expect(await sync.sync()).toBe(0)
    // The session grows: only its day is kept again, and the latest copy wins.
    await appendFile(sessionFile, tnegaLog([{ type: 'assistant/message', ts: OCT_15_9AM + 5000, payload: { content: 'Reusing KV blocks for a shared prompt.' } }]))
    expect(await sync.sync()).toBe(1)
    const tnega = (await kept.day('2026-10-15')).find((capture) => capture.from === 'tnega')
    expect(tnega?.text).toContain('Agent: Reusing KV blocks')
  })

  it('skips a session it cannot read and keeps the others', async () => {
    const tnegaHome = join(home, '.tnega')
    const sessions = join(tnegaHome, 'sessions', 'abc123')
    await mkdir(sessions, { recursive: true })
    await writeFile(join(sessions, '00000000-0000-4000-8000-000000000000.jsonl'), 'null\n')
    await writeFile(join(sessions, `${SESSION_ID}.jsonl`), tnegaLog([{ type: 'meta', ts: OCT_15_9AM, payload: { title: 'Inference costs' } }, { type: 'user/message', ts: OCT_15_9AM, payload: { content: 'What is prefix caching?' } }]))
    const sync = new ChatSync(kept, { tnegaHome, content: join(home, 'none'), cursorFile: join(paths.internal, 'chats.json') })
    expect(await sync.sync()).toBe(1)
    expect(await sync.sync()).toBe(0)
  })
})

describe('ChatGPT export', () => {
  const exported = [
    {
      title: 'LRU cache in Python',
      create_time: OCT_15_9AM / 1000,
      conversation_id: 'conv-1',
      current_node: 'c',
      mapping: {
        root: { parent: null, message: null },
        a: { parent: 'root', message: { author: { role: 'user' }, create_time: OCT_15_9AM / 1000, content: { content_type: 'text', parts: ['How do I build an LRU cache?'] } } },
        old: { parent: 'a', message: { author: { role: 'assistant' }, create_time: OCT_15_9AM / 1000 + 5, content: { content_type: 'text', parts: ['A regenerated answer.'] } } },
        b: { parent: 'a', message: { author: { role: 'assistant' }, create_time: OCT_15_9AM / 1000 + 9, content: { content_type: 'text', parts: ['A hash map and a linked list.'] } } },
        c: { parent: 'b', message: { author: { role: 'tool' }, create_time: OCT_15_9AM / 1000 + 10, content: { content_type: 'text', parts: ['tool output'] } } },
      },
    },
  ]

  it('follows the current branch and keeps your messages and the answers', () => {
    const [conversation] = readChatGptExport(new TextEncoder().encode(JSON.stringify(exported)))
    expect(conversation).toMatchObject({ from: 'chatgpt', id: 'conv-1', title: 'LRU cache in Python' })
    expect(conversation!.messages.map((message) => `${message.role}: ${message.text}`)).toEqual(['user: How do I build an LRU cache?', 'agent: A hash map and a linked list.'])
  })

  it('reads the export .zip too, and says so when it is not an export', () => {
    const zip = zipSync({ 'conversations.json': new TextEncoder().encode(JSON.stringify(exported)), 'chat.html': new Uint8Array([60]) })
    expect(readChatGptExport(zip)).toHaveLength(1)
    expect(() => readChatGptExport(new TextEncoder().encode('{"not":"a list"}'))).toThrow(/ChatGPT export/)
    expect(() => readChatGptExport(zipSync({ 'a.txt': new Uint8Array([1]) }))).toThrow(/conversations.json/)
  })

  it('is kept once, however often it is imported', async () => {
    const sync = new ChatSync(kept, { tnegaHome: join(home, 'none'), content: join(home, 'none'), cursorFile: join(paths.internal, 'chats.json') })
    const conversations = readChatGptExport(new TextEncoder().encode(JSON.stringify(exported)))
    expect(await sync.keepConversations(conversations)).toBe(1)
    expect(await sync.keepConversations(conversations)).toBe(0)
    expect((await kept.day('2026-10-15'))[0]).toMatchObject({ from: 'chatgpt', title: 'LRU cache in Python' })
  })
})

describe('reading trail settings', () => {
  it('is off until you add sites, and keeps sites as hosts', async () => {
    expect(await readSettings(paths)).toEqual({ trail: [], eveningHour: 21 })
    const saved = await writeSettings(paths, { trail: ['https://www.X.com/home', 'arxiv.org', 'not a site', 'arxiv.org'], eveningHour: 25 })
    expect(saved).toEqual({ trail: ['x.com', 'arxiv.org'], eveningHour: 21 })
    // A file that can't be read reads as the defaults, and saving repairs it.
    await writeFile(join(paths.internal, 'settings.json'), '{ not json')
    expect(await readSettings(paths)).toEqual({ trail: [], eveningHour: 21 })
    expect(await writeSettings(paths, { eveningHour: 20 })).toEqual({ trail: [], eveningHour: 20 })
    expect(siteOf('blog.example.com/post')).toBe('blog.example.com')
  })

  it('records pages on the chosen sites only', () => {
    expect(onTrail('https://x.com/karpathy/status/1', ['x.com'])).toBe(true)
    expect(onTrail('https://mobile.x.com/a', ['x.com'])).toBe(true)
    expect(onTrail('https://notx.com/a', ['x.com'])).toBe(false)
    expect(onTrail('file:///etc/passwd', ['x.com'])).toBe(false)
    expect(visitKey('https://arxiv.org/abs/1#section')).toBe('https://arxiv.org/abs/1')
    expect(visitKey('https://app.example.com/#/article/one')).toBe('https://app.example.com/#/article/one')
    expect(visitKey('https://app.example.com/#!/a')).toBe('https://app.example.com/#!/a')
  })
})
