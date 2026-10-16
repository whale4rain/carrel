import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyView, carrelRoots, fieldsOf, matches, NoteViews, Workspace, type NoteRow } from '../src/index.js'

const row = (title: string, more: Partial<NoteRow> = {}): NoteRow => ({ id: title, title, folder: '', tags: [], updated: '2026-10-16T10:00:00.000Z', created: '2026-10-01T10:00:00.000Z', links: 0, cites: 0, properties: {}, ...more })

const rows = [
  row('Elasticity', { folder: 'Micro', tags: ['exam', 'micro'], links: 3, properties: { status: 'Learning', 'next review': '2026-10-21', done: false } }),
  row('Tax incidence', { folder: 'Micro/Taxes', tags: ['exam'], properties: { status: 'New', 'next review': '2026-10-22' } }),
  row('Mankiw ch. 5', { folder: 'Reading', tags: ['exam'], cites: 9, properties: { status: 'Done', done: true } }),
  row('Inbox'),
]

describe('views of notes', () => {
  it('filters by folder, tags, properties and dates', () => {
    const titles = (filters: Parameters<typeof applyView>[1]['filters']): string[] => applyView(rows, { filters, sort: { field: 'title', descending: false } }).map((one) => one.title)
    expect(titles([{ field: 'folder', op: 'is', value: 'micro' }])).toEqual(['Elasticity', 'Tax incidence'])
    expect(titles([{ field: 'tags', op: 'is', value: '#exam' }, { field: 'property:Status', op: 'is not', value: 'done' }])).toEqual(['Elasticity', 'Tax incidence'])
    expect(titles([{ field: 'property:next review', op: 'before', value: '2026-10-22' }])).toEqual(['Elasticity'])
    expect(titles([{ field: 'property:done', op: 'is checked' }])).toEqual(['Mankiw ch. 5'])
    expect(titles([{ field: 'property:status', op: 'is empty' }])).toEqual(['Inbox'])
    expect(titles([{ field: 'title', op: 'contains', value: 'CH.' }])).toEqual(['Mankiw ch. 5'])
    expect(titles([{ field: 'cites', op: 'after', value: '1' }])).toEqual(['Mankiw ch. 5'])
    expect(matches(rows[0]!, { field: 'links', op: 'is', value: '3' })).toBe(true)
  })

  it('sorts, with rows missing the field last', () => {
    expect(applyView(rows, { filters: [], sort: { field: 'property:next review', descending: false } }).map((one) => one.title)).toEqual(['Elasticity', 'Tax incidence', 'Mankiw ch. 5', 'Inbox'])
    expect(applyView(rows, { filters: [], sort: { field: 'links', descending: true } })[0]!.title).toBe('Elasticity')
  })

  it('lists every field, properties by name', () => {
    expect(fieldsOf(rows)).toEqual(['title', 'folder', 'tags', 'updated', 'created', 'links', 'cites', 'property:done', 'property:next review', 'property:status'])
  })
})

describe('saved views', () => {
  let home: string
  let views: NoteViews
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'carrel-'))
    const workspace = new Workspace(carrelRoots(home))
    await workspace.createProject('Learn economics')
    views = new NoteViews(workspace)
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('keeps views in views.json', async () => {
    const view = await views.create('Learn economics', ' Exam prep ')
    expect(view).toMatchObject({ name: 'Exam prep', layout: 'table', columns: ['title', 'folder', 'tags', 'updated'] })
    const saved = await views.save('Learn economics', { ...view, filters: [{ field: 'tags', op: 'is', value: 'exam' }], columns: ['title', 'property:status'] })
    expect(await views.list('Learn economics')).toEqual([saved])
    expect(JSON.parse(await readFile(join(home, 'Carrel', 'Learn economics', 'views.json'), 'utf8'))).toMatchObject({ format: 1, views: [{ name: 'Exam prep' }] })
    await expect(views.save('Learn economics', { ...view, columns: ['nope'] })).rejects.toThrow('not a view')
    await views.remove('Learn economics', view.id)
    expect(await views.list('Learn economics')).toEqual([])
  })
})
