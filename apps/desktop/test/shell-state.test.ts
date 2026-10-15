import { carrelRoots, Workspace } from '@carrel/core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShellController } from '../src/main/shell-state.js'

let home: string
const controller = (): ShellController => new ShellController(new Workspace(carrelRoots(home)))

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-shell-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('ShellController', () => {
  it('starts with nothing open', async () => {
    expect(await controller().state()).toEqual({ projects: [] })
  })

  it('opens a new project at its first desk', async () => {
    const state = await controller().createProject('Learn economics')
    expect(state.projects).toEqual(['Learn economics'])
    expect(state.open?.desks.map((desk) => desk.name)).toEqual(['First desk'])
    expect(state.open?.desk).toBe(state.open?.desks[0]?.id)
  })

  it('comes back to the same project and desk after a restart', async () => {
    await controller().createProject('Learn economics')
    const created = await controller().createDesk('Elasticity')
    const elasticity = created.open?.desks.find((desk) => desk.name === 'Elasticity')
    expect(created.open?.desk).toBe(elasticity?.id)

    await controller().createProject('Statistics basics')
    await controller().openProject('Learn economics')

    const restarted = await controller().state()
    expect(restarted.open?.project).toBe('Learn economics')
    expect(restarted.open?.desk).toBe(elasticity?.id)
  })

  it('switches desks and projects', async () => {
    const first = await controller().createProject('Learn economics')
    await controller().createDesk('Elasticity')
    const firstDesk = first.open?.desks[0]?.id ?? ''
    expect((await controller().openDesk(firstDesk)).open?.desk).toBe(firstDesk)

    const other = await controller().createProject('Statistics basics')
    expect(other.open?.project).toBe('Statistics basics')
    expect(other.projects).toEqual(['Learn economics', 'Statistics basics'])
  })

  it('refuses a desk from elsewhere and a desk without a project', async () => {
    await expect(controller().createDesk('Elasticity')).rejects.toThrow(/Create a project first/)
    await controller().createProject('Learn economics')
    await expect(controller().openDesk('not-a-desk')).rejects.toThrow(/not in this project/)
  })
})

describe('sheets through the shell', () => {
  const blank = { id: 's1', itemId: null, x: 48, y: 48, w: 400, h: 300, scale: 1, z: 1 }

  it('saves sheets on the open project and reads them back after a restart', async () => {
    const state = await controller().createProject('Learn economics')
    const desk = state.open?.desk ?? ''
    await controller().saveSheets(desk, [blank], { kind: 'added', ids: ['s1'] })
    expect((await controller().desk(desk)).sheets).toEqual([blank])
  })

  it('adds sources to the open project', async () => {
    await controller().createProject('Learn economics')
    const pdf = join(home, 'Supply.pdf')
    await writeFile(pdf, '%PDF-1.4')
    const [paper] = await controller().addFiles([pdf])
    const page = await controller().addLink('https://example.com/rent')
    expect(paper).toEqual({ id: paper?.id, kind: 'paper', title: 'Supply', file: { name: 'Supply.pdf', size: 8 } })
    expect(page).toEqual({ id: page.id, kind: 'web_page', title: 'example.com · rent', url: 'https://example.com/rent' })
    expect((await controller().items()).map((item) => item.title).sort()).toEqual(['Supply', 'example.com · rent'])
    expect(new TextDecoder().decode(await controller().itemBytes(paper?.id ?? ''))).toBe('%PDF-1.4')
    await expect(controller().itemBytes(page.id)).rejects.toThrow(/linked/)
    await expect(controller().addFiles('nope')).rejects.toThrow(/not files/)
  })

  it('remembers the view of a desk, within zoom limits', async () => {
    const state = await controller().createProject('Learn economics')
    const desk = state.open?.desk ?? ''
    await controller().saveViewport(desk, { x: -40, y: 12, zoom: 0.5 })
    expect((await controller().desk(desk)).viewport).toEqual({ x: -40, y: 12, zoom: 0.5 })
    await expect(controller().saveViewport(desk, { x: 0, y: 0, zoom: 9 })).rejects.toThrow(/not a view/)
  })

  it('refuses sheets that are not sheets', async () => {
    const state = await controller().createProject('Learn economics')
    const desk = state.open?.desk ?? ''
    await expect(controller().saveSheets(desk, [{ ...blank, scale: 3 }], { kind: 'scaled', ids: ['s1'] })).rejects.toThrow(/not sheets/)
    await expect(controller().saveSheets(desk, [blank], { kind: '../x', ids: [] })).rejects.toThrow(/not a sheet change/)
  })
})

describe('that. through the shell', () => {
  it('keeps a that. on a PDF page and a video moment', async () => {
    await controller().createProject('Learn economics')
    const pdf = join(home, 'Supply.pdf')
    await writeFile(pdf, '%PDF-1.4')
    const [paper] = await controller().addFiles([pdf])
    const video = await controller().addLink('https://youtu.be/aqz-KE-bpKQ')
    const source = 'Demand is elastic when buyers react strongly.'
    const quoted = await controller().makeThat({ itemId: paper?.id, page: 3, text: { source, start: 0, end: 17 } })
    expect(quoted).toMatchObject({ itemId: paper?.id, label: 'p.3', text: 'Demand is elastic', image: false })
    const moment = await controller().makeThat({ itemId: video.id, seconds: 754.34, image: new Uint8Array([1, 2, 3]) })
    expect(moment).toMatchObject({ label: '12:34', image: true })
    expect([...((await controller().thatImage(moment.id)) ?? [])]).toEqual([1, 2, 3])
    const region = await controller().makeThat({ itemId: paper?.id, page: 2, region: { x: 10, y: 20, w: 30, h: 15 } })
    expect(region.selectors.at(-1)).toMatchObject({ value: 'xywh=percent:10,20,30,15' })
    expect((await controller().thats()).map((that) => that.label)).toEqual(['p.3', '12:34', 'p.2'])
  })

  it('refuses a that. outside the project or the text', async () => {
    await controller().createProject('Learn economics')
    const page = await controller().addLink('https://example.com/rent')
    await expect(controller().makeThat({ itemId: 'not-an-item', seconds: 1 })).rejects.toThrow()
    await expect(controller().makeThat({ itemId: page.id, text: { source: 'short', start: 2, end: 40 } })).rejects.toThrow(/not in the text/)
    await expect(controller().makeThat({ itemId: page.id })).rejects.toThrow(/not a place/)
  })
})

describe('notes through the shell', () => {
  it('starts a note, saves it, and lists it with the sources', async () => {
    const shell = controller()
    await shell.createProject('Learn economics')
    const note = await shell.createNote()
    expect(note).toMatchObject({ kind: 'note', title: 'Untitled note' })
    const doc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Elasticity' }] }] }
    expect(await shell.saveNote(note.id, doc)).toMatchObject({ id: note.id, title: 'Elasticity' })
    expect((await controller().items()).map((item) => [item.kind, item.title])).toEqual([['note', 'Elasticity']])
    expect((await shell.note(note.id)).doc).toEqual(doc)
  })

  it('refuses a document the editor could not have made', async () => {
    const shell = controller()
    await shell.createProject('Learn economics')
    const note = await shell.createNote()
    await expect(shell.saveNote(note.id, { type: 'doc', content: [{ type: 'script' }] })).rejects.toThrow('That is not a note.')
  })
})
