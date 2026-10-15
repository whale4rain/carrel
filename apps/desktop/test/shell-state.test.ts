import { carrelRoots, Threads, Workspace } from '@carrel/core'
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
    expect(paper).toEqual({ id: paper?.id, kind: 'paper', title: 'Supply', file: { name: 'Supply.pdf', size: 8 }, createdBy: 'user', createdAt: expect.any(String) })
    expect(page).toEqual({ id: page.id, kind: 'web_page', title: 'example.com · rent', url: 'https://example.com/rent', createdBy: 'user', createdAt: expect.any(String) })
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

describe('search through the shell', () => {
  it('finds notes, that.s and PDF pages, and reads each PDF once', async () => {
    const reads: string[] = []
    const shell = new ShellController(new Workspace(carrelRoots(home)), {
      readPages: async (path) => {
        reads.push(path)
        return ['Chapter 5', 'Elasticity of demand']
      },
    })
    try {
      await shell.createProject('Learn economics')
      const pdf = join(home, 'Supply.pdf')
      await writeFile(pdf, '%PDF-1.4')
      const [paper] = await shell.addFiles([pdf])
      await shell.makeThat({ itemId: paper?.id, page: 1, text: { source: 'Demand is elastic.', start: 0, end: 17 } })
      const note = await shell.createNote()
      await shell.saveNote(note.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Coffee has low elasticity' }] }] })
      const hits = await shell.search('elast')
      expect(hits.map((hit) => [hit.kind, hit.title])).toEqual(
        expect.arrayContaining([
          ['note', 'Coffee has low elasticity'],
          ['that', 'Supply p.1'],
          ['page', 'Supply'],
        ]),
      )
      expect(hits.find((hit) => hit.kind === 'page')).toMatchObject({ itemId: paper?.id, page: 2 })
      await shell.search('supply')
      expect(reads).toHaveLength(1)
      expect(await shell.search('  ')).toEqual([])
    } finally {
      shell.close()
    }
  })
})

describe("the agent's reads through the shell", () => {
  it('reads PDF pages and notes, and points at words the page has', async () => {
    const shell = new ShellController(new Workspace(carrelRoots(home)), {
      readPages: async () => ['Chapter 5', 'Habits and necessities tend\nto be inelastic.'],
    })
    try {
      await shell.createProject('Learn economics')
      const pdf = join(home, 'Supply.pdf')
      await writeFile(pdf, '%PDF-1.4')
      const [paper] = await shell.addFiles([pdf])
      const read = await shell.readItem('Learn economics', paper!.id, { from: 2, to: 2 })
      expect(read).toEqual({ title: 'Supply', kind: 'paper', text: '[p.2]\nHabits and necessities tend\nto be inelastic.', pages: 2 })
      const that = await shell.agentThat('Learn economics', paper!.id, 2, 'tend to be inelastic')
      expect(that).toMatchObject({ label: 'p.2', text: 'tend\nto be inelastic' })
      expect(await shell.thatText('Learn economics', that.id)).toMatchObject({ source: 'Supply', label: 'p.2', quote: 'tend\nto be inelastic' })
      await expect(shell.agentThat('Learn economics', paper!.id, 2, 'not on the page')).rejects.toThrow('not on page 2')
      const note = await shell.createNote()
      await shell.saveNote(note.id, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Coffee', marks: [{ type: 'bold' }] }] }] })
      expect(await shell.readItem('Learn economics', note.id)).toEqual({ title: 'Coffee', kind: 'note', text: '**Coffee**\n' })
    } finally {
      shell.close()
    }
  })
})

describe("the agent's proposals through the shell", () => {
  it('writes nothing until accepted, then makes a note, adds to one, or links a source', async () => {
    const shell = controller()
    await shell.createProject('Learn economics')
    const fresh = await shell.propose('Learn economics', { kind: 'note', text: '# Coffee\n\nA habit, so inelastic.' }, { why: 'You asked', asked: 'q1' })
    expect((await shell.items()).filter((item) => item.kind === 'note')).toEqual([])
    expect(await shell.proposalList()).toEqual([fresh])

    const { proposal, item } = await shell.decideProposal(fresh.id, true)
    expect(proposal).toMatchObject({ state: 'accepted', result: item?.id })
    expect(item).toMatchObject({ kind: 'note', title: 'Coffee' })

    const more = await shell.propose('Learn economics', { kind: 'note', note: item!.id, text: 'Tea too.' }, {})
    expect(more.target).toBe('Coffee')
    await shell.decideProposal(more.id, true)
    expect(await shell.readItem('Learn economics', item!.id)).toMatchObject({ text: expect.stringMatching(/inelastic\.\n\nTea too\./) })

    const source = await shell.propose('Learn economics', { kind: 'source', url: 'https://example.com/elasticity' }, {})
    const dismissed = await shell.decideProposal(source.id, false)
    expect(dismissed).toEqual({ proposal: expect.objectContaining({ state: 'dismissed' }) })
    expect((await shell.items()).filter((known) => known.kind !== 'note')).toEqual([])
    await expect(shell.decideProposal(source.id, true)).rejects.toThrow('already dismissed')

    const again = await shell.propose('Learn economics', { kind: 'source', url: 'https://example.com/elasticity' }, {})
    expect((await shell.decideProposal(again.id, true)).item).toMatchObject({ url: 'https://example.com/elasticity' })
    await expect(shell.propose('Learn economics', { kind: 'note', note: 'nope', text: 'x' }, {})).rejects.toThrow('not in this project')
    shell.close()
  })
})

describe('turns of the project thread through the shell', () => {
  it('points at a turn once, and adds it to a note with a chip back to it', async () => {
    const workspace = new Workspace(carrelRoots(home))
    const shell = new ShellController(workspace)
    await shell.createProject('Learn economics')
    const threads = new Threads(workspace)
    await threads.add('Learn economics', { by: 'user', text: 'Why is coffee inelastic?' })
    const answer = await threads.add('Learn economics', { by: 'agent', text: 'It is a **habit**.' })

    const that = await shell.thatTurn(answer.id)
    expect(that).toMatchObject({ itemId: 'thread:project', label: 'turn', text: 'It is a **habit**.' })
    expect(await shell.thatTurn(answer.id)).toEqual(that)
    await expect(shell.thatTurn('nope')).rejects.toThrow('not in the thread')
    expect(await shell.thatText('Learn economics', that.id)).toMatchObject({ source: 'Project thread', label: 'turn' })

    const fresh = await shell.addTurnToNote(answer.id, undefined)
    expect(fresh).toMatchObject({ kind: 'note', title: 'Why is coffee inelastic?', cites: [] })
    const text = (await shell.readItem('Learn economics', fresh.id)).text
    expect(text).toBe(`# Why is coffee inelastic?\n\nIt is a **habit**.\n\n[turn](that:${that.id})\n`)

    const note = await shell.createNote()
    await shell.addTurnToNote(answer.id, note.id)
    expect((await shell.readItem('Learn economics', note.id)).text).toContain(`[turn](that:${that.id})`)

    // A side thread's turns are pointed at the same way, under their own thread.
    await expect(shell.thatTurn(answer.id, 'side-1')).rejects.toThrow('not in this project')
    await threads.startSide('Learn economics', 'side-1', 'Coffee')
    const aside = await threads.add('Learn economics', { by: 'agent', text: 'On the side.' }, 'side-1')
    const sideThat = await shell.thatTurn(aside.id, 'side-1')
    expect(sideThat.itemId).toBe('thread:side-1')
    expect(await shell.thatText('Learn economics', sideThat.id)).toMatchObject({ source: 'Coffee' })
    shell.close()
  })
})
