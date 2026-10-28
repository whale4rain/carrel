import { addDays, dayOf, isDay, startOf, type Day } from './days.js'
import { words } from './embed.js'
import type { Capture } from './kept.js'
import { sourceLabel, type Piece } from './pieces.js'

/** What a half-remembered question says about when, where from and what. */
export interface Cues {
  /** The days to look in, first and last (inclusive). */
  from?: Day
  to?: Day
  /** Where it came from, as source labels start: "X", "Video", "Paper", "Chat", "LeetCode", "Blog", "Page", "Code". */
  sources: string[]
  /** What it was about. */
  words: string[]
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Words that name a source, and the label they mean. */
const SOURCE_WORDS: Record<string, string> = {
  x: 'X',
  tweet: 'X',
  tweets: 'X',
  twitter: 'X',
  thread: 'X',
  video: 'Video',
  videos: 'Video',
  youtube: 'Video',
  talk: 'Video',
  paper: 'Paper',
  papers: 'Paper',
  arxiv: 'Paper',
  pdf: 'Paper',
  chat: 'Chat',
  chats: 'Chat',
  chatgpt: 'Chat',
  asked: 'Chat',
  conversation: 'Chat',
  leetcode: 'LeetCode',
  blog: 'Blog',
  article: 'Blog',
  github: 'Code',
  repo: 'Code',
  code: 'Code',
  screenshot: 'Screenshot',
}

/** Words that only glue a cue together. */
const FILLER = new Set(['post', 'posts', 'saw', 'read', 'seen', 'last', 'this', 'week', 'month', 'ago', 'day', 'days', 'thing', 'something', 'stuff', 'today', 'yesterday', 'earlier'])

/**
 * Reads the cues in a question: "that post on inference costs, Tuesday" looks
 * on the last Tuesday for "inference costs"; "the X thread about paging last
 * week" looks at X posts from last week.
 */
export function readCues(query: string, today: Day): Cues {
  const lower = query.toLowerCase()
  let from: Day | undefined
  let to: Day | undefined
  const set = (a: Day, b: Day = a): void => {
    from = a
    to = b
  }
  if (/\btoday\b/.test(lower)) set(today)
  else if (/\byesterday\b/.test(lower)) set(addDays(today, -1))
  else if (/\blast week\b/.test(lower)) set(addDays(today, -13), addDays(today, -7))
  else if (/\bthis week\b/.test(lower)) set(addDays(today, -6), today)
  else if (/\blast month\b/.test(lower)) set(addDays(today, -60), addDays(today, -30))
  else if (/\bthis month\b/.test(lower)) set(addDays(today, -30), today)
  else {
    const ago = /\b(\d+|a|two|three|four|five|six) (day|days|week|weeks) ago\b/.exec(lower)
    const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b|\\b${name.slice(0, 3)}\\b`).test(lower))
    const date = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})\b|\b(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(lower)
    if (ago) {
      const n = { a: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }[ago[1] as 'a'] ?? Number(ago[1])
      const back = ago[2]!.startsWith('week') ? n * 7 : n
      set(addDays(today, -back - (ago[2]!.startsWith('week') ? 3 : 1)), addDays(today, -back + (ago[2]!.startsWith('week') ? 3 : 1)))
    } else if (date) {
      const month = MONTHS.indexOf((date[1] ?? date[4])!)
      const dayOfMonth = Number(date[2] ?? date[3])
      const start = startOf(today)
      let year = start.getFullYear()
      if (new Date(year, month, dayOfMonth) > start) year -= 1
      const found = dayOf(new Date(year, month, dayOfMonth))
      if (isDay(found)) set(found)
    } else if (weekday >= 0) {
      const back = (startOf(today).getDay() - weekday + 7) % 7
      // "Tuesday" said on a Tuesday means last week's, unless today is all there is.
      set(addDays(today, back === 0 ? -7 : -back))
    }
  }
  const sources = new Set<string>()
  const topic: string[] = []
  const raw = lower.match(/[\p{L}\p{N}]+/gu) ?? []
  for (const word of raw) {
    if (SOURCE_WORDS[word]) sources.add(SOURCE_WORDS[word]!)
  }
  for (const word of words(query)) {
    if (SOURCE_WORDS[word] || FILLER.has(word) || WEEKDAYS.some((name) => name === word || name.slice(0, 3) === word) || MONTHS.some((name) => word.startsWith(name) && word.length <= 9) || /^\d{1,2}$/.test(word)) continue
    topic.push(word)
  }
  return { ...(from ? { from } : {}), ...(to ? { to } : {}), sources: [...sources], words: topic }
}

/** Something found again: a piece, or a capture that was never made into one. */
export interface Recalled {
  type: 'piece' | 'capture'
  id: string
  day: Day
  title: string
  /** The words around what matched. */
  snippet: string
  /** Where it came from: "Blog", "X post", "Chat". */
  label: string
  url?: string
  /** The piece made from it, for a capture that has one. */
  piece?: string
  score: number
}

/**
 * Finds things again by their cues: within the days named, from the sources
 * named, scored by the words that match (rare words count more, a title more
 * than a body). Captures that became pieces lead to their piece.
 */
export function recall(query: string, today: Day, pieces: readonly Piece[], captures: readonly Capture[], limit = 20): Recalled[] {
  const cues = readCues(query, today)
  type Doc = { recalled: Omit<Recalled, 'score' | 'snippet'>; title: string[]; body: string[]; text: string }
  const byCapture = new Map<string, string>()
  for (const piece of pieces) for (const key of piece.captures) byCapture.set(key, piece.id)
  const docs: Doc[] = [
    ...pieces.map((piece) => ({
      recalled: { type: 'piece' as const, id: piece.id, day: piece.day, title: piece.title, label: piece.source.label, ...(piece.source.url ? { url: piece.source.url } : {}) },
      title: words(`${piece.title} ${piece.group}`),
      body: words(`${piece.body} ${piece.source.title}`),
      text: piece.body,
    })),
    ...captures.map((capture) => {
      const piece = byCapture.get(capture.key)
      return {
        recalled: { type: 'capture' as const, id: capture.id, day: dayOf(capture.at), title: capture.title, label: sourceLabel(capture), ...(capture.url ? { url: capture.url } : {}), ...(piece ? { piece } : {}) },
        title: words(`${capture.title} ${capture.reason ?? ''}`),
        body: words(`${capture.text} ${capture.url ?? ''}`),
        text: capture.text,
      }
    }),
  ]
  const inDays = (day: Day): boolean => (!cues.from || day >= cues.from) && (!cues.to || day <= cues.to)
  const fromSource = (label: string): boolean => cues.sources.length === 0 || cues.sources.some((source) => label.startsWith(source) || (source === 'Blog' && label === 'Page'))
  const pool = docs.filter((doc) => inDays(doc.recalled.day) && fromSource(doc.recalled.label))
  // Rarer words say more.
  const weight = new Map<string, number>()
  for (const word of cues.words) {
    const having = pool.filter((doc) => doc.title.includes(word) || doc.body.includes(word)).length
    weight.set(word, Math.log(1 + pool.length / (1 + having)))
  }
  const scored = pool.flatMap((doc) => {
    let score = 0
    for (const word of cues.words) {
      if (doc.title.includes(word)) score += 2 * weight.get(word)!
      else if (doc.body.includes(word)) score += weight.get(word)!
    }
    // With no topic words, the cues alone pick: everything from then, newest first.
    if (cues.words.length > 0 && score === 0) return []
    if (doc.recalled.type === 'piece') score *= 1.1
    return [{ ...doc.recalled, score, snippet: snippet(doc.text, cues.words) }]
  })
  // A capture whose piece is also found shows once, as the piece.
  const found = new Set(scored.filter((hit) => hit.type === 'piece').map((hit) => hit.id))
  return scored
    .filter((hit) => !(hit.type === 'capture' && hit.piece && found.has(hit.piece)))
    .sort((a, b) => b.score - a.score || b.day.localeCompare(a.day))
    .slice(0, limit)
}

/** About 160 characters around the first matching word. */
function snippet(text: string, topic: readonly string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  const at = topic.map((word) => lower.indexOf(word)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - 60)
  const cut = flat.slice(start, start + 160)
  return `${start > 0 ? '…' : ''}${cut}${start + 160 < flat.length ? '…' : ''}`
}

