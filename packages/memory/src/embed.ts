import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readJson, writeJson } from '@carrel/core'
import type { MemoryPaths } from './kept.js'

/** Turns texts into vectors whose closeness means closeness in meaning. */
export interface Embedder {
  /** Names the vectors in the cache; a new embedder starts a new cache. */
  readonly name: string
  embed(texts: readonly string[]): Promise<number[][]>
}

/** Width of the local vectors. */
const DIMENSIONS = 1024

const STOP = new Set(
  'a an and are as at be been but by can could do does for from had has have how i if in into is it its just like may me might more most my no not of on one or our so some such than that the their them then there these they this those to too up us was we were what when where which while who why will with would you your about also over only very via vs using use used get got make makes made'.split(' '),
)

/** Words of a text, lower-cased, without stop words; plurals folded so "caches" meets "cache". */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map((word) => (word.length > 4 && word.endsWith('es') && !word.endsWith('ses') ? word.slice(0, -2) : word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))
}

/**
 * The first embedder: hashed words and word pairs, with no network. It finds
 * pieces that share their words; the agent then judges whether they are
 * related, so close-but-unrelated candidates cost a little, not a wrong line.
 * An embeddings route can replace it (DeepSeek has none).
 */
export const localEmbedder: Embedder = {
  name: 'local-hash-v1',
  embed: async (texts) => texts.map(hashVector),
}

function hashVector(text: string): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0)
  const tokens = words(text)
  const add = (feature: string, weight: number): void => {
    const digest = createHash('md5').update(feature).digest()
    const index = digest.readUInt32LE(0) % DIMENSIONS
    vector[index]! += digest[4]! & 1 ? weight : -weight
  }
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  for (const [token, count] of counts) add(token, 1 + Math.log(count))
  for (let i = 1; i < tokens.length; i++) add(`${tokens[i - 1]} ${tokens[i]}`, 0.5)
  return normalize(vector)
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i]! * b[i]!
  return dot
}

function normalize(vector: number[]): number[] {
  const length = Math.hypot(...vector)
  return length === 0 ? vector : vector.map((value) => value / length)
}

/** Vectors kept between runs in ~/.carrel/memory/vectors.json, by embedder and text. */
export class VectorCache {
  private loaded: Promise<Record<string, number[]>> | undefined

  constructor(
    private readonly paths: MemoryPaths,
    private readonly embedder: Embedder,
  ) {}

  async vectors(texts: readonly string[]): Promise<number[][]> {
    const cache = await (this.loaded ??= this.read())
    const keys = texts.map((text) => createHash('sha256').update(this.embedder.name).update('\n').update(text).digest('hex').slice(0, 24))
    const missing = [...new Set(keys.map((key, index) => (cache[key] ? -1 : index)).filter((index) => index >= 0))]
    if (missing.length > 0) {
      const made = await this.embedder.embed(missing.map((index) => texts[index]!))
      missing.forEach((index, n) => (cache[keys[index]!] = made[n]!))
      // The local vectors are cheap to make again; only a remote embedder's are worth keeping.
      if (this.embedder !== localEmbedder) await writeJson(this.file(), { embedder: this.embedder.name, vectors: cache })
    }
    return keys.map((key) => cache[key]!)
  }

  private async read(): Promise<Record<string, number[]>> {
    if (this.embedder === localEmbedder) return {}
    const read = (await readJson(this.file())) as { embedder?: string; vectors?: Record<string, number[]> } | undefined
    return read?.embedder === this.embedder.name && read.vectors ? read.vectors : {}
  }

  private file(): string {
    return join(this.paths.internal, 'vectors.json')
  }
}
