import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carrelRoots, matchOf, SearchIndex, Workspace, type Searchable } from '../src/index.js'

let home: string
let index: SearchIndex

const project: Searchable = {
  notes: [
    { id: 'n1', title: 'Elasticity', text: 'Elasticity\nCoffee is a habit, so it is inelastic. #micro' },
    { id: 'n2', title: 'Shopping list', text: 'Shopping list\nMilk, café crème' },
  ],
  items: [
    { id: 'i1', title: 'Principles of Economics' },
    { id: 'i2', title: 'Supply and demand explained' },
  ],
  thats: [
    { id: 't1', itemId: 'i1', label: 'p.12', text: 'price elasticity of demand' },
    { id: 't2', itemId: 'i2', label: '3:04', text: '' },
  ],
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-'))
  index = new SearchIndex(new Workspace(carrelRoots(home)))
})

afterEach(async () => {
  index.close()
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('SearchIndex', () => {
  it('keeps the index in ~/.carrel, never in ~/Carrel', () => {
    index.sync('Learn economics', project)
    expect(existsSync(join(home, '.carrel', 'index', 'Learn%20economics.sqlite'))).toBe(true)
    expect(existsSync(join(home, 'Carrel'))).toBe(false)
  })

  it('finds notes, sources and that.s, the half-typed last word too', () => {
    index.sync('Learn economics', project)
    const hits = index.search('Learn economics', 'elast')
    expect(hits.map((hit) => [hit.kind, hit.id])).toEqual(expect.arrayContaining([['note', 'n1'], ['that', 't1']]))
    const that = hits.find((hit) => hit.kind === 'that')
    expect(that).toMatchObject({ itemId: 'i1', title: 'Principles of Economics p.12' })
    expect(that?.snippet).toContain('\u0001elasticity\u0002')
    expect(index.search('Learn economics', 'supply')).toEqual([{ kind: 'source', id: 'i2', itemId: 'i2', title: 'Supply and demand explained', snippet: '' }])
  })

  it('needs every word, ignores accents and treats search syntax as text', () => {
    index.sync('Learn economics', project)
    expect(index.search('Learn economics', 'coffee habit').map((hit) => hit.id)).toEqual(['n1'])
    expect(index.search('Learn economics', 'coffee milk')).toEqual([])
    expect(index.search('Learn economics', 'cafe creme').map((hit) => hit.id)).toEqual(['n2'])
    expect(index.search('Learn economics', 'NOT "coffee" OR (')).toEqual([])
    expect(index.search('Learn economics', '  ')).toEqual([])
  })

  it('replaces what it knew on every sync', () => {
    index.sync('Learn economics', project)
    index.sync('Learn economics', { ...project, notes: [] })
    expect(index.search('Learn economics', 'coffee')).toEqual([])
  })

  it('keeps PDF pages until the file changes or leaves the project', () => {
    index.setPages('Learn economics', 'i1', 'a', 'Principles of Economics', ['Chapter 1', '', 'Elasticity of supply'])
    expect(index.hasPages('Learn economics', 'i1', 'a')).toBe(true)
    expect(index.hasPages('Learn economics', 'i1', 'b')).toBe(false)
    index.sync('Learn economics', project)
    const page = index.search('Learn economics', 'supply').find((hit) => hit.kind === 'page')
    expect(page).toMatchObject({ id: 'i1', itemId: 'i1', page: 3, title: 'Principles of Economics' })
    expect(index.pages('Learn economics', 'i1')).toEqual([
      { page: 1, text: 'Chapter 1' },
      { page: 3, text: 'Elasticity of supply' },
    ])
    index.keepPages('Learn economics', ['i2'])
    expect(index.search('Learn economics', 'supply').some((hit) => hit.kind === 'page')).toBe(false)
    expect(index.hasPages('Learn economics', 'i1', 'a')).toBe(false)
  })
})

describe('matchOf', () => {
  it('quotes each word and lets it be the start of a longer one', () => {
    expect(matchOf('price elast')).toBe('"price"* "elast"*')
    expect(matchOf('"x" OR y*')).toBe('"x"* "OR"* "y"*')
    expect(matchOf('!!')).toBeUndefined()
  })
})
