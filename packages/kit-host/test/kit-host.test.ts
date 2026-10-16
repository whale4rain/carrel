import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { carrelRoots, Workspace } from '@carrel/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isKitPath, kitOfHost, kitOrigin, kitPolicy, KitShelf, parseManifest, ProjectKits, withMargin } from '../src/index.js'

const minimal = { name: 'language', title: 'Language', sheets: [{ id: 'stages', file: 'sheets/stages.html' }] }

describe('parseManifest', () => {
  it('fills in what a small manifest leaves out', () => {
    expect(parseManifest(minimal)).toEqual({
      name: 'language',
      title: 'Language',
      description: '',
      version: 1,
      sheets: [{ id: 'stages', title: 'Language', file: 'sheets/stages.html', size: { w: 420, h: 520 } }],
      store: {},
      scripts: [],
      reads: [],
      net: [],
      needs: [],
    })
  })

  it('reads the full example from the design', () => {
    const manifest = parseManifest({
      name: 'vocab-cards',
      title: 'Vocabulary cards',
      version: 3,
      sheets: [
        { id: 'card', title: 'Card', file: 'card.html', size: { w: 360, h: 480 } },
        { id: 'review', file: 'review.html' },
      ],
      store: { words: { schemaVersion: 2 } },
      scripts: ['schedule.js'],
      reads: ['notes', 'kit:graded-reader'],
      net: ['api.dictionary.example'],
      needs: ['that.receive', 'agent.ask', 'speak'],
    })
    expect(manifest.store).toEqual({ words: { schemaVersion: 2 } })
    expect(manifest.needs).toEqual(['that.receive', 'agent.ask', 'speak'])
    expect(manifest.sheets.map((sheet) => sheet.id)).toEqual(['card', 'review'])
  })

  it.each([
    [{ ...minimal, name: 'Language' }, 'lower-case name'],
    [{ ...minimal, title: ' ' }, 'needs a title'],
    [{ ...minimal, sheets: [] }, 'at least one sheet'],
    [{ ...minimal, sheets: [{ id: 'a', file: '../outside.html' }] }, 'inside the kit'],
    [{ ...minimal, sheets: [{ id: 'a', file: 'page.js' }] }, 'an .html file'],
    [{ ...minimal, sheets: [{ id: 'a', file: 'a.html' }, { id: 'a', file: 'b.html' }] }, 'same id'],
    [{ ...minimal, sheets: [{ id: 'a', file: 'a.html', size: { w: 20, h: 20 } }] }, 'size outside'],
    [{ ...minimal, store: { words: {} } }, 'schemaVersion'],
    [{ ...minimal, reads: ['everything'] }, 'asks to read'],
    [{ ...minimal, net: ['https://example.com/'] }, 'not a host name'],
    [{ ...minimal, needs: ['files'] }, "kits can't ask for"],
  ])('refuses a bad manifest in plain words (%#)', (manifest, words) => {
    expect(() => parseManifest(manifest)).toThrow(words)
  })
})

describe('isKitPath', () => {
  it('keeps paths inside the kit', () => {
    expect(isKitPath('sheets/deck.html')).toBe(true)
    for (const path of ['', '/etc/passwd', '../x.html', 'a/../../x', 'a\\b.html', '.hidden/x.html', 'a/./b.html', 'C:/x.html']) expect(isKitPath(path)).toBe(false)
  })
})

describe('the sandbox', () => {
  it('gives each kit its own origin', () => {
    expect(kitOrigin('language')).toBe('https://language.kit.carrel.app')
    expect(kitOfHost('language.kit.carrel.app')).toBe('language')
    expect(kitOfHost('kit.carrel.app')).toBeUndefined()
    expect(kitOfHost('a.b.kit.carrel.app')).toBeUndefined()
    expect(kitOfHost('desk.carrel.app')).toBeUndefined()
  })

  it('keeps a page off the network and other origins', () => {
    const policy = kitPolicy('language')
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain('script-src https://language.kit.carrel.app ')
    expect(policy).not.toMatch(/\*|https:(?!\/\/language)/)
  })

  it('puts Margin and the bridge first in the head', () => {
    expect(withMargin('<!doctype html><html><head><title>x</title></head><body></body></html>')).toBe(
      '<!doctype html><html><head><link rel="stylesheet" href="/_margin/margin.css"><script src="/_margin/kit.js"></script><title>x</title></head><body></body></html>',
    )
    expect(withMargin('<!doctype html><p>Hello</p>')).toBe('<!doctype html><head><link rel="stylesheet" href="/_margin/margin.css"><script src="/_margin/kit.js"></script></head><p>Hello</p>')
    expect(withMargin('<HEAD lang="en"><style></style>')).toMatch(/^<HEAD lang="en"><link/)
  })
})

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-kits-'))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function kit(root: string, folder: string, manifest: unknown): Promise<void> {
  await mkdir(join(root, folder, 'sheets'), { recursive: true })
  await writeFile(join(root, folder, 'kit.json'), JSON.stringify(manifest))
}

describe('KitShelf', () => {
  it('lists kits from its roots, an earlier root winning, and says what is wrong with the rest', async () => {
    const first = join(home, 'app-kits')
    const second = join(home, 'my-kits')
    await kit(first, 'language', minimal)
    await kit(second, 'language', { ...minimal, title: 'Mine' })
    await kit(second, 'maths', { ...minimal, name: 'maths', title: 'Maths' })
    await kit(second, 'broken', { name: 'broken' })
    await kit(second, 'misnamed', { ...minimal, name: 'other' })
    await mkdir(join(second, 'not-a-kit'))
    const shelf = new KitShelf([first, second, join(home, 'missing')])
    const { kits, problems } = await shelf.list()
    expect(kits.map((each) => each.title)).toEqual(['Language', 'Maths'])
    expect(problems.map((problem) => problem.message)).toEqual(["This kit's manifest needs a title.", `This kit's manifest names it "other", but its folder is "misnamed".`])
    expect(await shelf.file('language', 'sheets/stages.html')).toBe(join(first, 'language', 'sheets', 'stages.html'))
    expect(await shelf.file('language', '../maths/kit.json')).toBeUndefined()
    expect(await shelf.file('nothing', 'kit.json')).toBeUndefined()
  })

  it('reads the first-party kits in the repository', async () => {
    const { kits, problems } = await new KitShelf([join(import.meta.dirname, '../../../kits')]).list()
    expect(problems).toEqual([])
    expect(kits.map((each) => each.name)).toContain('language')
  })
})

describe('ProjectKits', () => {
  it('adds a kit to a project once, as an event', async () => {
    const workspace = new Workspace(carrelRoots(home), () => new Date('2026-10-16T09:00:00Z'))
    const project = await workspace.createProject('Spanish')
    const kits = new ProjectKits(workspace, () => new Date('2026-10-16T09:00:00Z'))
    const manifest = parseManifest(minimal)
    const added = await kits.add(project.folder, manifest)
    expect(added).toEqual({ format: added.format, name: 'language', version: 1, addedBy: 'user', addedAt: '2026-10-16T09:00:00.000Z' })
    expect(await kits.add(project.folder, { ...manifest, version: 2 })).toEqual(added)
    expect(await kits.list(project.folder)).toEqual([added])
    const events = (await readFile(join(home, 'Carrel', project.folder, 'events.jsonl'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as { type: string })
    expect(events.filter((event) => event.type === 'kit.added')).toHaveLength(1)
  })
})
