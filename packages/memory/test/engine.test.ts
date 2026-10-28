import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { carrelRoots } from '@carrel/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DISTILL_MARK, jsonIn, memoryPaths, MemoryEngine, parsePieces, readCues, RELATE_MARK, type Ask, type MemoryPaths } from '../src/index.js'

let home: string
let paths: MemoryPaths
let now: Date
let asked: Array<{ system: string; user: string }>

const OCT_14 = new Date(2026, 9, 14, 10, 0)
const OCT_15 = new Date(2026, 9, 15, 10, 0)
const OCT_16 = new Date(2026, 9, 16, 21, 0)

/** A stand-in model: one piece per capture, titled after it; a "builds on" line to each new piece's first candidate. */
const ask: Ask = async (system, user) => {
  asked.push({ system, user })
  if (system.startsWith(DISTILL_MARK)) {
    const pieces = [...user.matchAll(/^\[(\d+)\] \w+ from \w+: (.+)$/gm)].map(([, n, title]) => ({ title, body: `About ${title}.`, group: 'Inference', from: [Number(n)] }))
    return '```json\n' + JSON.stringify({ pieces }) + '\n```'
  }
  if (system.startsWith(RELATE_MARK)) {
    const lines = [...user.matchAll(/^New piece (\d+)[^\n]*\nOlder pieces:\n\s+(c\d+)/gm)].map(([, n, ref]) => ({ new: Number(n), old: ref, relation: 'builds on' }))
    return JSON.stringify({ lines })
  }
  throw new Error('unexpected prompt')
}

function engine(): MemoryEngine {
  return new MemoryEngine({ paths, ask, now: () => now })
}

const text = (topic: string): string => `${topic} keeps the key value cache of attention in fixed size blocks for inference.`

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-engine-'))
  paths = memoryPaths(carrelRoots(home))
  now = OCT_16
  asked = []
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('MemoryEngine', () => {
  it('turns a day of captures into pieces, once', async () => {
    const memory = engine()
    await memory.kept.add({ kind: 'page', from: 'keep', title: 'Paged attention', text: text('Paged attention'), url: 'https://blog.vllm.ai/paged', at: OCT_15.toISOString() })
    await memory.kept.add({ kind: 'visit', from: 'trail', title: 'Login', text: 'Sign in', at: OCT_15.toISOString() })
    const first = await memory.distill('2026-10-15')
    expect(first.pieces.map((piece) => piece.title)).toEqual(['Paged attention'])
    expect(first.pieces[0]!.source.label).toBe('Blog')
    const file = JSON.parse(await readFile(join(paths.pieces, '2026-10-15.json'), 'utf8'))
    expect(file.pieces).toHaveLength(1)
    expect(Object.keys(file.distilled)).toHaveLength(2)
    expect(file.cost.calls).toBe(1)

    expect(await memory.pending('2026-10-16')).toEqual([])
    const again = await memory.distill('2026-10-15')
    expect(again.pieces).toEqual([])
    expect(asked).toHaveLength(1)
  })

  it('distills a chat again when it grew', async () => {
    const memory = engine()
    await memory.kept.add({ kind: 'chat', from: 'tnega', key: 'chat:tnega:a:2026-10-15', title: 'KV cache', text: text('KV cache'), at: OCT_15.toISOString() })
    await memory.distill('2026-10-15')
    await memory.kept.add({ kind: 'chat', from: 'tnega', key: 'chat:tnega:a:2026-10-15', title: 'KV cache', text: `${text('KV cache')} And eviction.`, at: OCT_15.toISOString() })
    expect(await memory.pending('2026-10-16')).toEqual(['2026-10-15'])
    const again = await memory.distill('2026-10-15')
    expect(again.pieces).toEqual([])
    expect(asked[1]!.user).toContain('Pieces already made today')
  })

  it('draws lines only between days, and a removed line never returns', async () => {
    const memory = engine()
    await memory.kept.add({ kind: 'page', from: 'keep', title: 'Paged attention', text: text('Paged attention'), at: OCT_14.toISOString() })
    await memory.distill('2026-10-14')
    expect(asked).toHaveLength(1)

    await memory.kept.add({ kind: 'page', from: 'keep', title: 'Prefix caching', text: text('Prefix caching'), at: OCT_16.toISOString() })
    await memory.kept.add({ kind: 'selection', from: 'keep', title: 'Block tables', text: text('Block tables'), at: OCT_16.toISOString() })
    const today = await memory.distill('2026-10-16')
    expect(today.pieces).toHaveLength(2)
    expect(today.lines).toHaveLength(2)
    const older = (await memory.pieces.day('2026-10-14')).pieces[0]!
    for (const line of today.lines) {
      expect(line.to).toBe(older.id)
      expect(line.drawnOn).toBe('2026-10-16')
    }

    const gone = today.lines[0]!
    await memory.removeLine(gone.id)
    expect((await memory.lines.shown()).map((line) => line.id)).toEqual([today.lines[1]!.id])
    const corrections = (await readFile(paths.corrections, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    expect(corrections[0]).toMatchObject({ type: 'line.removed', line: gone.id, relation: 'builds on' })

    // Drawing again offers neither the removed pair nor the kept one.
    const added = await memory.lines.add([{ from: gone.from, to: gone.to, relation: 'same idea', drawnOn: '2026-10-16' }], now)
    expect(added).toEqual([])
  })

  it('shows removed lines to the agent as lines not to draw', async () => {
    const memory = engine()
    await memory.kept.add({ kind: 'page', from: 'keep', title: 'Paged attention', text: text('Paged attention'), at: OCT_14.toISOString() })
    await memory.distill('2026-10-14')
    await memory.kept.add({ kind: 'page', from: 'keep', title: 'Prefix caching', text: text('Prefix caching'), at: OCT_15.toISOString() })
    const second = await memory.distill('2026-10-15')
    await memory.removeLine(second.lines[0]!.id)
    await memory.kept.add({ kind: 'page', from: 'keep', title: 'Radix trees', text: text('Radix trees'), at: OCT_16.toISOString() })
    await memory.distill('2026-10-16')
    const relate = asked.filter((call) => call.system.startsWith(RELATE_MARK)).at(-1)!
    expect(relate.user).toContain('Lines the person removed before')
    expect(relate.user).toContain('"Prefix caching" builds on "Paged attention"')
  })

  it('edits and removes pieces, keeping each change as a correction', async () => {
    const memory = engine()
    await memory.kept.add({ kind: 'page', from: 'keep', title: 'Paged attention', text: text('Paged attention'), at: OCT_14.toISOString() })
    await memory.distill('2026-10-14')
    await memory.kept.add({ kind: 'page', from: 'keep', title: 'Prefix caching', text: text('Prefix caching'), at: OCT_16.toISOString() })
    const { pieces, lines } = await memory.distill('2026-10-16')
    const edited = await memory.editPiece(pieces[0]!.id, { title: '  Prefix caching  reuses blocks ' })
    expect(edited).toMatchObject({ title: 'Prefix caching reuses blocks', edited: true })
    await memory.removePiece(pieces[0]!.id)
    expect((await memory.pieces.day('2026-10-16')).pieces).toEqual([])
    expect(await memory.lines.shown()).toEqual([])
    expect((await memory.lines.all())[0]!.id).toBe(lines[0]!.id)
    const types = (await readFile(paths.corrections, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).type)
    expect(types).toEqual(['piece.edited', 'piece.removed'])
  })

  it('finds pieces and things never made into pieces by cues', async () => {
    const memory = engine()
    await memory.kept.add({ kind: 'page', from: 'keep', title: 'Inference costs are falling', text: text('Inference costs'), url: 'https://x.com/someone/status/1', at: OCT_14.toISOString() })
    await memory.distill('2026-10-14')
    await memory.kept.add({ kind: 'visit', from: 'trail', title: 'Speculative decoding explained', text: 'Draft models guess tokens that a big model checks in one pass.', url: 'https://example.com/spec', at: OCT_15.toISOString() })

    const post = await memory.recall('that post on inference costs, Wednesday')
    expect(post[0]).toMatchObject({ type: 'piece', title: 'Inference costs are falling', label: 'X post' })
    expect(post.filter((found) => found.title === 'Inference costs are falling')).toHaveLength(1)

    const unsaved = await memory.recall('speculative decoding')
    expect(unsaved[0]).toMatchObject({ type: 'capture', day: '2026-10-15' })
  })
})

describe('prompts', () => {
  it('reads JSON from a fenced or wordy answer and drops bad pieces', () => {
    expect(jsonIn('Sure: {"a":1} done')).toEqual({ a: 1 })
    const pieces = parsePieces('{"pieces":[{"title":"A","body":"b","from":[1]},{"title":"","from":[1]},{"title":"C","from":[9]}]}', 2)
    expect(pieces).toEqual([{ title: 'A', body: 'b', group: 'Loose ends', from: [1] }])
    expect(() => parsePieces('no', 1)).toThrow('did not answer with pieces')
  })

  it('reads time cues', () => {
    expect(readCues('yesterday', '2026-10-16')).toMatchObject({ from: '2026-10-15', to: '2026-10-15' })
    expect(readCues('the video on tuesday', '2026-10-16')).toMatchObject({ from: '2026-10-13', to: '2026-10-13', sources: ['Video'] })
  })
})
