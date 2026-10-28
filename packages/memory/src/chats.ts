import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isMissing, readJson, writeJson } from '@carrel/core'
import { dayOf, type Day } from './days.js'
import { CAPTURE_TEXT, oneLine, type CaptureFrom, type Kept, type NewCapture } from './kept.js'

/** One message of a conversation, from any chat source. */
export interface ChatMessage {
  role: 'user' | 'agent'
  text: string
  /** Milliseconds since the epoch. */
  at: number
}

export interface Conversation {
  from: Extract<CaptureFrom, 'tnega' | 'carrel' | 'chatgpt'>
  /** Stable across reads: a session id, a project and thread, a ChatGPT conversation id. */
  id: string
  /** Its own title, when it has a real one. */
  title?: string
  messages: ChatMessage[]
}

/** Longest one message is in a kept transcript; a long answer keeps its start. */
const MESSAGE_TEXT = 4_000
/** Titles tools give a conversation before it has one. */
const PLACEHOLDER_TITLES = new Set(['new session', 'new chat', 'untitled', ''])

/**
 * A conversation as captures: one per day it ran on, holding that day's turns
 * as a transcript. The key names the conversation and the day, so a chat that
 * grows during the day is kept again and the latest copy wins.
 */
export function chatCaptures(conversation: Conversation): NewCapture[] {
  const byDay = new Map<Day, ChatMessage[]>()
  for (const message of conversation.messages) {
    if (!message.text.trim() || !Number.isFinite(message.at)) continue
    const day = dayOf(message.at)
    byDay.set(day, [...(byDay.get(day) ?? []), message])
  }
  const titled = conversation.title && !PLACEHOLDER_TITLES.has(conversation.title.trim().toLowerCase()) ? conversation.title : undefined
  return [...byDay].map(([day, messages]) => {
    const first = messages.find((message) => message.role === 'user') ?? messages[0]!
    const transcript = messages.map((message) => `${message.role === 'user' ? 'You' : 'Agent'}: ${clip(message.text.trim(), MESSAGE_TEXT)}`).join('\n\n')
    return {
      key: `chat:${conversation.from}:${conversation.id}:${day}`,
      at: new Date(Math.max(...messages.map((message) => message.at))).toISOString(),
      kind: 'chat',
      from: conversation.from,
      title: clip(oneLine(titled ?? first.text), 120),
      text: clip(transcript, CAPTURE_TEXT),
    }
  })
}

/** A tnega session log (`~/.tnega/sessions/<workspace>/<id>.jsonl`) as a conversation. */
export function readTnegaSession(id: string, text: string): Conversation {
  let title: string | undefined
  const messages: ChatMessage[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let event: { type?: unknown; ts?: unknown; payload?: Record<string, unknown> }
    try {
      event = JSON.parse(line) as typeof event
    } catch {
      continue
    }
    const payload = event.payload
    if (typeof payload !== 'object' || payload === null) continue
    if ((event.type === 'meta' || event.type === 'meta/patch') && typeof payload.title === 'string') title = payload.title
    if (typeof event.ts !== 'number') continue
    if ((event.type === 'user/message' || event.type === 'assistant/message') && typeof payload.content === 'string') {
      messages.push({ role: event.type === 'user/message' ? 'user' : 'agent', text: payload.content, at: event.ts })
    }
  }
  return { from: 'tnega', id, ...(title !== undefined ? { title } : {}), messages }
}

/** A Carrel thread (`~/Carrel/<project>/threads/<thread>.jsonl`) as a conversation. Failed answers are left out. */
export function readCarrelThread(project: string, thread: string, text: string, title?: string): Conversation {
  const messages: ChatMessage[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const turn = JSON.parse(line) as { by?: unknown; text?: unknown; createdAt?: unknown; error?: unknown }
      if ((turn.by !== 'user' && turn.by !== 'agent') || typeof turn.text !== 'string' || typeof turn.createdAt !== 'string' || turn.error !== undefined) continue
      messages.push({ role: turn.by, text: turn.text, at: Date.parse(turn.createdAt) })
    } catch {
      // A torn line; skip it.
    }
  }
  return { from: 'carrel', id: `${project}/${thread}`, ...(title !== undefined ? { title } : {}), messages }
}

export interface ChatSyncOptions {
  /** tnega's home (`TNEGA_HOME`, or ~/.tnega). */
  tnegaHome: string
  /** ~/Carrel, whose projects' threads are read. */
  content: string
  /** Where what was read is remembered: ~/.carrel/memory/chats.json. */
  cursorFile: string
}

interface Cursor {
  /** Each file read, as it was then. */
  files: Record<string, { size: number; mtimeMs: number }>
  /** Each capture kept, by key, with a hash of its text, so an unchanged day isn't kept again. */
  keys: Record<string, string>
}

/**
 * Keeps your conversations without asking: tnega's sessions and Carrel's own
 * threads. Only files that changed since the last sync are read, and only
 * days whose transcript changed are kept again.
 */
export class ChatSync {
  constructor(
    private readonly kept: Kept,
    private readonly options: ChatSyncOptions,
  ) {}

  /** Reads what changed; returns how many captures were kept. */
  async sync(): Promise<number> {
    const cursor = await this.readCursor()
    let added = 0
    for (const source of await this.sources()) {
      // One file that can't be read or understood is skipped; the others are still kept.
      let info
      let captures: NewCapture[]
      try {
        info = await stat(source.file)
        const seen = cursor.files[source.file]
        if (seen && seen.size === info.size && seen.mtimeMs === info.mtimeMs) continue
        captures = chatCaptures(source.read(await readFile(source.file, 'utf8')))
      } catch (error) {
        if (!isMissing(error)) console.error(`memory: skipping ${source.file}:`, error)
        continue
      }
      // A failed write still stops the sync, so the cursor never claims what wasn't kept.
      added += await this.keepCaptures(captures, cursor)
      cursor.files[source.file] = { size: info.size, mtimeMs: info.mtimeMs }
    }
    await writeJson(this.options.cursorFile, cursor)
    return added
  }

  /** Keeps a conversation that came from somewhere else (an import), skipping days already kept as they are. */
  async keepConversations(conversations: readonly Conversation[]): Promise<number> {
    const cursor = await this.readCursor()
    let added = 0
    for (const conversation of conversations) added += await this.keep(conversation, cursor)
    await writeJson(this.options.cursorFile, cursor)
    return added
  }

  private async keep(conversation: Conversation, cursor: Cursor): Promise<number> {
    return this.keepCaptures(chatCaptures(conversation), cursor)
  }

  private async keepCaptures(captures: readonly NewCapture[], cursor: Cursor): Promise<number> {
    let added = 0
    for (const capture of captures) {
      const hash = createHash('sha256').update(capture.title).update('\n').update(capture.text).digest('hex').slice(0, 16)
      if (cursor.keys[capture.key!] === hash) continue
      await this.kept.add(capture)
      cursor.keys[capture.key!] = hash
      added++
    }
    return added
  }

  private async sources(): Promise<Array<{ file: string; read: (text: string) => Conversation }>> {
    const found: Array<{ file: string; read: (text: string) => Conversation }> = []
    const sessions = join(this.options.tnegaHome, 'sessions')
    for (const workspace of await folders(sessions)) {
      for (const name of await this.listed(join(sessions, workspace))) {
        const id = name.slice(0, -'.jsonl'.length)
        if (name.endsWith('.jsonl') && SESSION_ID.test(id)) found.push({ file: join(sessions, workspace, name), read: (text) => readTnegaSession(id, text) })
      }
    }
    for (const project of await folders(this.options.content)) {
      const threads = join(this.options.content, project, 'threads')
      const titles = await sideTitles(join(threads, 'side-threads.json'))
      for (const name of await this.listed(threads)) {
        if (!name.endsWith('.jsonl')) continue
        const thread = name.slice(0, -'.jsonl'.length)
        found.push({ file: join(threads, name), read: (text) => readCarrelThread(project, thread, text, titles.get(thread)) })
      }
    }
    return found
  }

  /** A folder's files; one that can't be listed is skipped, so the other folders are still read. */
  private async listed(dir: string): Promise<string[]> {
    try {
      return await files(dir)
    } catch (error) {
      console.error(`memory: skipping ${dir}:`, error)
      return []
    }
  }

  private async readCursor(): Promise<Cursor> {
    const read = (await readJson(this.options.cursorFile)) as Partial<Cursor> | undefined
    return { files: { ...(read?.files ?? {}) }, keys: { ...(read?.keys ?? {}) } }
  }
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function sideTitles(file: string): Promise<Map<string, string>> {
  const list = await readJson(file).catch(() => undefined)
  const titles = new Map<string, string>()
  if (Array.isArray(list)) for (const side of list as Array<{ id?: unknown; title?: unknown }>) if (typeof side.id === 'string' && typeof side.title === 'string') titles.set(side.id, side.title)
  return titles
}

async function folders(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch (error) {
    if (isMissing(error) || (error instanceof Error && 'code' in error && error.code === 'ENOTDIR')) return []
    throw error
  }
}

async function files(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}
