import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { carrelRoots, Workspace } from '../src/index.js'

let home: string
let workspace: Workspace

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-'))
  workspace = new Workspace(carrelRoots(home), () => new Date('2026-10-14T12:00:00Z'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('Workspace', () => {
  it('keeps the name Memory for what you learn', async () => {
    await expect(workspace.createProject('memory')).rejects.toThrow(/Memory/)
  })

  it('has no projects before the first one', async () => {
    expect(await workspace.listProjects()).toEqual([])
  })

  it('creates a project folder with one desk', async () => {
    const opened = await workspace.createProject('Learn economics')
    expect(opened.project.name).toBe('Learn economics')
    expect(opened.desks.map((desk) => desk.name)).toEqual(['First desk'])

    const folder = join(home, 'Carrel', 'Learn economics')
    const project = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8')) as { desks: string[] }
    expect(project.desks).toEqual([opened.desks[0]?.id])
    const desk = JSON.parse(await readFile(join(folder, 'desks', `${opened.desks[0]?.id}.json`), 'utf8')) as object
    expect(desk).toMatchObject({ name: 'First desk', viewport: { x: 0, y: 0, zoom: 1 }, sheets: [] })
  })

  it('reopens projects and desks from disk, in order', async () => {
    await workspace.createProject('Learn economics')
    await workspace.createDesk('Learn economics', 'Elasticity')
    await workspace.createDesk('Learn economics', 'Supply & demand')

    const restarted = new Workspace(carrelRoots(home))
    expect(await restarted.listProjects()).toEqual(['Learn economics'])
    const opened = await restarted.openProject('Learn economics')
    expect(opened.desks.map((desk) => desk.name)).toEqual(['First desk', 'Elasticity', 'Supply & demand'])
  })

  it('records every change as an event with its actor', async () => {
    await workspace.createProject('Learn economics')
    await workspace.createDesk('Learn economics', 'Elasticity')
    const events = await workspace.readEvents('Learn economics')
    expect(events.map((event) => [event.seq, event.actor, event.type])).toEqual([
      [1, 'user', 'project.created'],
      [2, 'user', 'desk.created'],
      [3, 'user', 'desk.created'],
    ])
    expect(events[2]?.payload).toMatchObject({ name: 'Elasticity' })
  })

  it('refuses duplicate and invalid names', async () => {
    await workspace.createProject('Learn economics')
    await expect(workspace.createProject('learn economics')).rejects.toThrow(/already a project/)
    await expect(workspace.createProject('a/b')).rejects.toThrow(/not allowed/)
    await expect(workspace.createDesk('Learn economics', 'first desk')).rejects.toThrow(/already has a desk/)
    await expect(workspace.createDesk('Learn economics', '  ')).rejects.toThrow(/empty/)
  })

  it('ignores folders that are not projects', async () => {
    await mkdir(join(home, 'Carrel', 'Photos'), { recursive: true })
    await writeFile(join(home, 'Carrel', 'notes.txt'), 'hi')
    await workspace.createProject('Learn economics')
    expect(await workspace.listProjects()).toEqual(['Learn economics'])
  })

  it('keeps what was open last in ~/.carrel, not in the project', async () => {
    expect(await workspace.readSettings()).toEqual({})
    const settings = { project: 'Learn economics', desks: { 'Learn economics': 'abc' } }
    await workspace.writeSettings(settings)
    const restarted = new Workspace(carrelRoots(home))
    expect(await restarted.readSettings()).toEqual(settings)
    const onDisk = await readFile(join(home, '.carrel', 'settings.json'), 'utf8')
    expect(JSON.parse(onDisk)).toEqual(settings)
  })

  it('treats a broken settings file as no settings', async () => {
    await mkdir(join(home, '.carrel'), { recursive: true })
    await writeFile(join(home, '.carrel', 'settings.json'), '{not json')
    expect(await workspace.readSettings()).toEqual({})
  })
})

describe('sheets', () => {
  it('saves a desk\'s sheets and records the gesture as one event', async () => {
    const opened = await workspace.createProject('Learn economics')
    const deskId = opened.desks[0]?.id ?? ''
    const sheet = { id: 's1', itemId: null, x: 48, y: 48, w: 400, h: 300, scale: 1, z: 1 }
    await workspace.saveSheets('Learn economics', deskId, [sheet], { kind: 'added', ids: ['s1'] })
    await workspace.saveSheets('Learn economics', deskId, [{ ...sheet, x: 120 }], { kind: 'moved', ids: ['s1'] })

    const restarted = new Workspace(carrelRoots(home))
    expect((await restarted.readDesk('Learn economics', deskId)).sheets).toEqual([{ ...sheet, x: 120 }])
    const events = await restarted.readEvents('Learn economics')
    expect(events.slice(-2).map((event) => [event.type, event.payload])).toEqual([
      ['sheets.added', { desk: deskId, sheets: ['s1'] }],
      ['sheets.moved', { desk: deskId, sheets: ['s1'] }],
    ])
  })

  it('remembers a desk view without logging an event', async () => {
    const opened = await workspace.createProject('Learn economics')
    const deskId = opened.desks[0]?.id ?? ''
    const before = (await workspace.readEvents('Learn economics')).length
    await workspace.saveViewport('Learn economics', deskId, { x: 10, y: 20, zoom: 0.75 })
    expect((await workspace.readDesk('Learn economics', deskId)).viewport).toEqual({ x: 10, y: 20, zoom: 0.75 })
    expect(await workspace.readEvents('Learn economics')).toHaveLength(before)
  })

  it('refuses two sheets with one id', async () => {
    const opened = await workspace.createProject('Learn economics')
    const sheet = { id: 's1', itemId: null, x: 0, y: 0, w: 400, h: 300, scale: 1, z: 1 }
    await expect(
      workspace.saveSheets('Learn economics', opened.desks[0]?.id ?? '', [sheet, sheet], { kind: 'added', ids: ['s1'] }),
    ).rejects.toThrow(/share an id/)
  })
})
