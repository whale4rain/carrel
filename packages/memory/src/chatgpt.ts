import { unzipSync } from 'fflate'
import type { ChatMessage, Conversation } from './chats.js'

/**
 * A ChatGPT data export, read once: `conversations.json`, or the export's
 * .zip with that file inside. Each conversation follows its current branch
 * (the answers you kept, not the ones you regenerated away), and only your
 * messages and ChatGPT's answers are taken.
 */
export function readChatGptExport(bytes: Uint8Array): Conversation[] {
  const json = isZip(bytes) ? conversationsInZip(bytes) : new TextDecoder().decode(bytes)
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    throw new Error('That is not a ChatGPT export: conversations.json could not be read.')
  }
  if (!Array.isArray(data)) throw new Error('That is not a ChatGPT export: conversations.json should hold a list of conversations.')
  return data.flatMap((entry) => {
    const conversation = readConversation(entry)
    return conversation && conversation.messages.length > 0 ? [conversation] : []
  })
}

interface ExportNode {
  parent?: string | null
  message?: {
    author?: { role?: string }
    create_time?: number | null
    content?: { content_type?: string; parts?: unknown[]; text?: unknown }
  } | null
}

function readConversation(entry: unknown): Conversation | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const raw = entry as { id?: unknown; conversation_id?: unknown; title?: unknown; create_time?: unknown; mapping?: unknown; current_node?: unknown }
  const id = typeof raw.conversation_id === 'string' ? raw.conversation_id : typeof raw.id === 'string' ? raw.id : undefined
  if (!id || typeof raw.mapping !== 'object' || raw.mapping === null) return undefined
  const mapping = raw.mapping as Record<string, ExportNode>
  const started = typeof raw.create_time === 'number' ? raw.create_time * 1000 : Date.now()
  // The current branch, from its last message back to the root.
  const path: ExportNode[] = []
  let node = typeof raw.current_node === 'string' ? raw.current_node : lastNode(mapping)
  const seen = new Set<string>()
  for (let step = node ? mapping[node] : undefined; node && step && !seen.has(node); step = node ? mapping[node] : undefined) {
    seen.add(node)
    path.push(step)
    node = step.parent ?? undefined
  }
  const messages: ChatMessage[] = []
  let at = started
  for (const step of path.reverse()) {
    const message = step.message
    const role = message?.author?.role
    if (!message || (role !== 'user' && role !== 'assistant')) continue
    const text = textOf(message.content)
    if (!text) continue
    if (typeof message.create_time === 'number') at = message.create_time * 1000
    messages.push({ role: role === 'user' ? 'user' : 'agent', text, at })
  }
  return { from: 'chatgpt', id, ...(typeof raw.title === 'string' ? { title: raw.title } : {}), messages }
}

function textOf(content: { content_type?: string; parts?: unknown[]; text?: unknown } | undefined): string {
  if (!content) return ''
  if (Array.isArray(content.parts)) return content.parts.filter((part): part is string => typeof part === 'string').join('\n').trim()
  return typeof content.text === 'string' ? content.text.trim() : ''
}

/** Older exports have no current node: take a leaf. */
function lastNode(mapping: Record<string, ExportNode>): string | undefined {
  const parents = new Set(Object.values(mapping).map((node) => node.parent))
  return Object.keys(mapping).filter((id) => !parents.has(id)).at(-1)
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b
}

function conversationsInZip(bytes: Uint8Array): string {
  const files = unzipSync(bytes, { filter: (file) => /(^|\/)conversations\.json$/.test(file.name) })
  const found = Object.values(files)[0]
  if (!found) throw new Error('That .zip has no conversations.json in it. Choose the ChatGPT data export.')
  return new TextDecoder().decode(found)
}
