import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Workspace } from './workspace.js'

/**
 * Search within a project: SQLite full-text search (FTS5) over its notes,
 * source titles, *that.* quotes and PDF pages. The index is app internals,
 * so it lives in ~/.carrel/index/<project>.sqlite, never in ~/Carrel. It can
 * always be rebuilt from the project's files.
 */
export type SearchKind = 'note' | 'source' | 'that' | 'page'

export interface SearchHit {
  kind: SearchKind
  /** The note, item or *that.* it found. */
  id: string
  /** The item it is in (a page's or a *that.*'s source). */
  itemId?: string
  page?: number
  title: string
  /** Words around the match (matches sit between \u0001 and \u0002); empty for a source, whose title is all there is. */
  snippet: string
}

/** What a project has to search, apart from PDF pages. */
export interface Searchable {
  notes: Array<{ id: string; title: string; text: string }>
  items: Array<{ id: string; title: string }>
  thats: Array<{ id: string; itemId: string; label: string; text: string }>
}

export const HIT_START = '\u0001'
export const HIT_END = '\u0002'

/** Results a search returns at most. */
const LIMIT = 30

export class SearchIndex {
  private readonly open = new Map<string, DatabaseSync>()

  constructor(private readonly workspace: Workspace) {}

  /** Replaces what the index knows of notes, titles and *that.*s. */
  sync(folder: string, searchable: Searchable): void {
    const db = this.db(folder)
    const titles = new Map(searchable.items.map((item) => [item.id, item.title]))
    db.exec('BEGIN')
    try {
      db.exec("DELETE FROM entries WHERE kind IN ('note', 'source', 'that')")
      const insert = db.prepare('INSERT INTO entries (kind, ref, item, page, title, body) VALUES (?, ?, ?, ?, ?, ?)')
      for (const note of searchable.notes) insert.run('note', note.id, null, null, note.title, note.text)
      for (const item of searchable.items) insert.run('source', item.id, item.id, null, item.title, '')
      for (const that of searchable.thats) {
        if (that.text.length > 0) insert.run('that', that.id, that.itemId, null, `${titles.get(that.itemId) ?? 'A source'} ${that.label}`.trim(), that.text)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** Whether a source's pages are indexed as they are now (`stamp` changes when the file does). */
  hasPages(folder: string, itemId: string, stamp: string): boolean {
    const row = this.db(folder).prepare('SELECT stamp FROM paged WHERE item = ?').get(itemId) as { stamp?: string } | undefined
    return row?.stamp === stamp
  }

  setPages(folder: string, itemId: string, stamp: string, title: string, pages: readonly string[]): void {
    const db = this.db(folder)
    db.exec('BEGIN')
    try {
      db.prepare("DELETE FROM entries WHERE kind = 'page' AND item = ?").run(itemId)
      const insert = db.prepare("INSERT INTO entries (kind, ref, item, page, title, body) VALUES ('page', ?, ?, ?, ?, ?)")
      pages.forEach((text, i) => {
        if (text.trim().length > 0) insert.run(itemId, itemId, i + 1, title, text)
      })
      db.prepare('INSERT INTO paged (item, stamp) VALUES (?, ?) ON CONFLICT(item) DO UPDATE SET stamp = excluded.stamp').run(itemId, stamp)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** A PDF's page texts as indexed, by page number (blank pages are left out). */
  pages(folder: string, itemId: string): Array<{ page: number; text: string }> {
    const rows = this.db(folder).prepare("SELECT page, body FROM entries WHERE kind = 'page' AND item = ? ORDER BY CAST(page AS INTEGER)").all(itemId) as Array<{ page: number; body: string }>
    return rows.map((row) => ({ page: Number(row.page), text: row.body }))
  }

  /** Forgets the pages of sources no longer in the project. */
  keepPages(folder: string, itemIds: readonly string[]): void {
    const db = this.db(folder)
    const keep = new Set(itemIds)
    const known = db.prepare('SELECT item FROM paged').all() as Array<{ item: string }>
    for (const { item } of known) {
      if (keep.has(item)) continue
      db.prepare("DELETE FROM entries WHERE kind = 'page' AND item = ?").run(item)
      db.prepare('DELETE FROM paged WHERE item = ?').run(item)
    }
  }

  /** The best matches for every word typed (the last one may be half typed). */
  search(folder: string, query: string, limit = LIMIT): SearchHit[] {
    const match = matchOf(query)
    if (!match) return []
    const rows = this.db(folder)
      .prepare(
        `SELECT kind, ref, item, page, title,
          snippet(entries, 5, '${HIT_START}', '${HIT_END}', '…', 14) AS body
        FROM entries WHERE entries MATCH ? ORDER BY bm25(entries, 0, 0, 0, 0, 4.0, 1.0) LIMIT ?`,
      )
      .all(match, limit) as Array<{ kind: SearchKind; ref: string; item: string | null; page: number | null; title: string; body: string }>
    return rows.map((row) => ({
      kind: row.kind,
      id: row.ref,
      ...(row.item !== null ? { itemId: row.item } : {}),
      ...(row.page !== null ? { page: Number(row.page) } : {}),
      title: row.title,
      snippet: row.body,
    }))
  }

  close(): void {
    for (const db of this.open.values()) db.close()
    this.open.clear()
  }

  private db(folder: string): DatabaseSync {
    const known = this.open.get(folder)
    if (known) return known
    const dir = join(this.workspace.roots.internal, 'index')
    mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, `${encodeURIComponent(folder)}.sqlite`))
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entries USING fts5(
        kind UNINDEXED, ref UNINDEXED, item UNINDEXED, page UNINDEXED, title, body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS paged (item TEXT PRIMARY KEY, stamp TEXT NOT NULL);
    `)
    this.open.set(folder, db)
    return db
  }
}

/** Every word must match; each is quoted, so FTS5 syntax typed by accident is just text. */
export function matchOf(query: string): string | undefined {
  const words = query
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .slice(0, 12)
  if (words.length === 0) return undefined
  return words.map((word) => `"${word}"*`).join(' ')
}
