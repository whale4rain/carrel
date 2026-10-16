import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  Anchors,
  fromMarkdown,
  isDocumentFile,
  isNoteDoc,
  readDocument,
  sectionTexts,
  Library,
  Notes,
  plainText,
  Proposals,
  PROJECT_THREAD,
  threadItem,
  threadOf,
  Threads,
  turnOf,
  turnSelector,
  toMarkdown,
  SearchIndex,
  momentSelector,
  pageSelector,
  regionSelector,
  textSelectors,
  titleFromUrl,
  type AnchorFile,
  type DeskFile,
  type ItemFile,
  type NoteFile,
  type Mention,
  type NoteDoc,
  type NoteSummary,
  type OpenProject,
  type Proposal,
  type ReadingPosition,
  type ReadingDocument,
  type ProposalChange,
  type Selector,
  type Sheet,
  type SheetChange,
  type Viewport,
  type Workspace,
} from '@carrel/core'
import type { ItemText, ThatText } from '@carrel/agent'
import { askLines, KitHost, kitOrigin, ProjectKits, unanswered, type KitManifest, type KitShelf } from '@carrel/kit-host'
import type { ProposalView } from '../shared/agent-api.js'
import type { DeskView, ItemView, KitView, NoteView, SearchHitView, ShellState, ThatView } from '../shared/workspace-api.js'

/** Reads each page's text from a stored PDF. */
export type PageReader = (path: string) => Promise<string[]>

/**
 * Turns the workspace on disk into what the shell shows, and remembers what
 * was open in ~/.carrel/settings.json so a restart comes back to it.
 */
export class ShellController {
  private readonly workspace: Workspace
  private readonly library: Library
  private readonly anchors: Anchors
  private readonly notes: Notes
  private readonly proposals: Proposals
  private readonly threads: Threads
  private readonly index: SearchIndex
  private readonly readPages: PageReader | undefined
  private readonly kitShelf: KitShelf | undefined
  private readonly projectKits: ProjectKits
  private readonly kitHost: KitHost | undefined
  /** PDFs being read for search, by item. */
  private readonly reading = new Map<string, Promise<void>>()

  constructor(workspace: Workspace, options: { readPages?: PageReader; kits?: KitShelf } = {}) {
    this.workspace = workspace
    this.library = new Library(workspace)
    this.anchors = new Anchors(workspace)
    this.notes = new Notes(workspace)
    this.proposals = new Proposals(workspace)
    this.threads = new Threads(workspace)
    this.index = new SearchIndex(workspace)
    this.readPages = options.readPages
    this.kitShelf = options.kits
    this.projectKits = new ProjectKits(workspace)
    this.kitHost =
      options.kits &&
      new KitHost(workspace, options.kits, {
        notes: async (folder) => Promise.all((await this.notes.list(folder)).map(async (note) => ({ id: note.id, title: note.title, text: (await this.readItem(folder, note.id)).text }))),
        sources: async (folder) => (await this.library.list(folder)).map((item) => ({ id: item.id, kind: item.kind, title: item.title })),
        thats: async (folder) => {
          const titles = new Map((await this.library.list(folder)).map((item) => [item.id, item.title]))
          return (await this.anchors.list(folder))
            .filter((anchor) => titles.has(anchor.itemId))
            .map((anchor) => ({ id: anchor.id, label: anchor.label, ...(anchor.snapshot.text ? { text: anchor.snapshot.text } : {}), source: titles.get(anchor.itemId)! }))
        },
      })
  }

  async state(): Promise<ShellState> {
    const projects = await this.workspace.listProjects()
    const settings = await this.workspace.readSettings()
    const folder = settings.project !== undefined && projects.includes(settings.project) ? settings.project : projects[0]
    if (folder === undefined) return { projects }
    const opened = await this.workspace.openProject(folder)
    const remembered = settings.desks?.[folder]
    const desk = opened.desks.find((entry) => entry.id === remembered) ?? opened.desks[0]
    return { projects, open: summary(opened, desk?.id) }
  }

  async createProject(name: string): Promise<ShellState> {
    const opened = await this.workspace.createProject(name)
    await this.remember(opened.folder, opened.desks[0]?.id)
    return this.state()
  }

  async openProject(name: string): Promise<ShellState> {
    // Each project comes back at the desk it was left on.
    await this.workspace.openProject(name)
    await this.remember(name, undefined)
    return this.state()
  }

  async createDesk(name: string): Promise<ShellState> {
    const folder = await this.openFolder()
    const desk = await this.workspace.createDesk(folder, name)
    await this.remember(folder, desk.id)
    return this.state()
  }

  async openDesk(id: string): Promise<ShellState> {
    const folder = await this.openFolder()
    const opened = await this.workspace.openProject(folder)
    if (!opened.desks.some((desk) => desk.id === id)) throw new Error('That desk is not in this project.')
    await this.remember(folder, id)
    return this.state()
  }

  async desk(id: string): Promise<DeskView> {
    return view(await this.workspace.readDesk(await this.openFolder(), id))
  }

  /** Sheets come from the renderer, so they're checked before they reach the file. */
  async saveSheets(id: string, sheets: unknown, change: unknown): Promise<DeskView> {
    if (!Array.isArray(sheets) || !sheets.every(isSheet)) throw new Error('Those are not sheets.')
    if (!isChange(change)) throw new Error('That is not a sheet change.')
    return view(await this.workspace.saveSheets(await this.openFolder(), id, sheets, { kind: change.kind, ids: change.ids }))
  }

  async saveViewport(id: string, viewport: unknown): Promise<DeskView> {
    if (!isViewport(viewport)) throw new Error('That is not a view of a desk.')
    const { x, y, zoom } = viewport
    return view(await this.workspace.saveViewport(await this.openFolder(), id, { x, y, zoom }))
  }

  /** The project's sources, then its notes (most recently changed first), then its kits' sheets. */
  async items(): Promise<ItemView[]> {
    const { open } = await this.state()
    if (!open) return []
    const sources = await this.citedItems(open.project)
    return [
      ...(await this.library.list(open.project)).map(itemView),
      ...(await this.notes.list(open.project)).map((note) => noteItem(note, sources)),
      ...(await this.kitItems(open.project)),
    ]
  }

  /** The kits installed on this computer, and whether the open project uses each. */
  async kits(): Promise<KitView[]> {
    if (!this.kitShelf) return []
    const { open } = await this.state()
    const used = new Map(open ? (await this.projectKits.list(open.project)).map((kit) => [kit.name, kit]) : [])
    return (await this.kitShelf.list()).kits.map((kit) => ({
      name: kit.name,
      title: kit.title,
      description: kit.description,
      sheets: kit.sheets.map((sheet) => ({ id: sheet.id, title: sheet.title })),
      added: used.has(kit.name),
      asks: askLines(unanswered(kit, used.get(kit.name))),
    }))
  }

  /**
   * Adds a kit to the open project (once); returns its sheets, ready for the
   * desk. A kit that asks for more than its own store needs `allow`: the
   * person saw what it asks and said yes.
   */
  async addKit(name: string, allow = false): Promise<ItemView[]> {
    const folder = await this.openFolder()
    const kit = await this.kitShelf?.get(name)
    if (!kit) throw new Error(`There is no kit called "${name}" on this computer.`)
    const known = (await this.projectKits.list(folder)).find((used) => used.name === name)
    const asks = askLines(unanswered(kit, known))
    if (asks.length > 0 && !allow) throw new Error(`The ${kit.title} kit asks to: ${asks.join('; ')}. Allow it to add it.`)
    await this.projectKits.add(folder, kit)
    if (asks.length > 0) await this.projectKits.allow(folder, kit)
    return kitSheets(kit)
  }

  /** A call from a kit's page through its bridge, checked against its manifest and what was allowed. */
  async kitCall(name: string, method: string, args: unknown[]): Promise<unknown> {
    if (!this.kitHost) throw new Error('Kits are not available.')
    return this.kitHost.call(await this.openFolder(), name, method, args)
  }

  private async kitItems(folder: string): Promise<ItemView[]> {
    if (!this.kitShelf) return []
    const installed = new Map((await this.kitShelf.list()).kits.map((kit) => [kit.name, kit]))
    return (await this.projectKits.list(folder)).flatMap((kit) => {
      const manifest = installed.get(kit.name)
      return manifest ? kitSheets(manifest) : []
    })
  }

  async createNote(folder = '', title?: string): Promise<ItemView> {
    const doc: NoteDoc | undefined = title ? { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] }] } : undefined
    return noteItem(await this.notes.create(await this.openFolder(), doc, 'user', folder), new Map())
  }

  async mentions(id: string): Promise<{ linked: Mention[]; unlinked: Mention[] }> {
    return this.notes.mentions(await this.openFolder(), id)
  }

  async pinNote(id: string, pinned: boolean): Promise<ItemView> {
    const folder = await this.openFolder()
    return noteItem(await this.notes.pin(folder, id, pinned), await this.citedItems(folder))
  }

  async dailyNote(): Promise<ItemView> {
    const folder = await this.openFolder()
    return noteItem(await this.notes.daily(folder), await this.citedItems(folder))
  }

  async linkMention(from: string, to: string): Promise<ItemView> {
    const folder = await this.openFolder()
    return noteItem(await this.notes.linkMention(folder, from, to), await this.citedItems(folder))
  }

  async noteFolders(): Promise<string[]> {
    return this.notes.folders(await this.openFolder())
  }

  async createFolder(path: string): Promise<string> {
    return this.notes.createFolder(await this.openFolder(), path)
  }

  async renameFolder(from: string, to: string): Promise<string> {
    return this.notes.renameFolder(await this.openFolder(), from, to)
  }

  async moveNote(id: string, to: string): Promise<ItemView> {
    const folder = await this.openFolder()
    return noteItem(await this.notes.move(folder, id, to), await this.citedItems(folder))
  }

  async note(id: string): Promise<NoteView> {
    return noteView(await this.notes.read(await this.openFolder(), id))
  }

  /** A note's new text from the editor, checked before it is written. */
  async saveNote(id: string, doc: unknown): Promise<ItemView> {
    if (typeof id !== 'string' || !isNoteDoc(doc)) throw new Error('That is not a note.')
    const folder = await this.openFolder()
    return noteItem(await this.notes.save(folder, id, doc), await this.citedItems(folder))
  }

  /** Which item each *that.* points into, so a note knows the sources it cites. */
  private async citedItems(folder: string): Promise<Map<string, string>> {
    return new Map((await this.anchors.list(folder)).map((anchor) => [anchor.id, anchor.itemId]))
  }

  async addFiles(paths: unknown): Promise<ItemView[]> {
    if (!Array.isArray(paths) || !paths.every((path) => typeof path === 'string')) throw new Error('Those are not files.')
    const folder = await this.openFolder()
    const added: ItemView[] = []
    for (const path of paths) added.push(itemView(await this.library.addFile(folder, path)))
    // Their pages are read for search now, so the first search needn't wait.
    for (const item of added) void this.readForSearch(folder, item.id).catch(() => undefined)
    return added
  }

  /**
   * Searches the open project: note text, source titles, *that.* quotes and
   * PDF pages. The index is brought up to date first; a PDF's pages are read
   * once, and again only when its file changes.
   */
  async search(query: string): Promise<SearchHitView[]> {
    const { open } = await this.state()
    return open ? this.searchIn(open.project, query) : []
  }

  /** Search in a given project (the agent's tool asks for its own project). */
  async searchIn(folder: string, query: string): Promise<SearchHitView[]> {
    if (query.trim().length === 0) return []
    const items = await this.library.list(folder)
    const notes = await Promise.all((await this.notes.list(folder)).map((note) => this.notes.read(folder, note.id)))
    const thats = await this.anchors.list(folder)
    this.index.sync(folder, {
      notes: notes.map((note) => ({ id: note.id, title: note.title, text: plainText(note.doc) })),
      items: items.map((item) => ({ id: item.id, title: item.title })),
      thats: thats.map((that) => ({ id: that.id, itemId: that.itemId, label: that.label, text: that.snapshot.text ?? '' })),
    })
    this.index.keepPages(
      folder,
      items.map((item) => item.id),
    )
    for (const item of items) if (item.source.storage === 'stored') await this.readForSearch(folder, item.id).catch(() => undefined)
    return this.index.search(folder, query)
  }

  /** Reads a stored PDF's pages into the index, unless they are there already. */
  private readForSearch(folder: string, id: string): Promise<void> {
    const key = `${folder}/${id}`
    const known = this.reading.get(key)
    if (known) return known
    const run = (async () => {
      const item = await this.library.read(folder, id)
      if (item.source.storage !== 'stored') return
      // A file read as text has a section where a PDF has a page.
      const document = isDocumentFile(item.source.file)
      const read = document ? async (): Promise<string[]> => sectionTexts(await this.document(id, folder)) : this.readPages
      if (!read) return
      const path = await this.library.filePath(folder, id)
      const info = await stat(path)
      const stamp = `${info.size}:${Math.round(info.mtimeMs)}`
      if (this.index.hasPages(folder, id, stamp)) return
      this.index.setPages(folder, id, stamp, item.title, await read(path))
    })().finally(() => this.reading.delete(key))
    this.reading.set(key, run)
    return run
  }

  // ---- What the agent's tools read (see ProjectAccess in @carrel/agent) ----

  /** A note's Markdown, or a PDF's page texts (`pages` 1-based, inclusive). */
  async readItem(folder: string, id: string, pages?: { from: number; to: number }): Promise<ItemText> {
    const note = await this.notes.read(folder, id).catch(() => undefined)
    if (note) return { title: note.title, kind: 'note', text: toMarkdown(note.doc) }
    const item = await this.library.read(folder, id)
    if (item.source.storage !== 'stored') return { title: item.title, kind: item.kind, text: "This source is linked, not stored; its text can't be read yet." }
    await this.readForSearch(folder, id)
    const document = isDocumentFile(item.source.file)
    const all = this.index.pages(folder, id)
    const last = all.at(-1)?.page ?? 0
    const from = pages?.from ?? 1
    const to = pages?.to ?? Math.min(last, from + 9)
    const text = all
      .filter(({ page }) => page >= from && page <= to)
      .map(({ page, text: words }) => `[${document ? '§' : 'p.'}${page}]\n${words}`)
      .join('\n\n')
    return { title: item.title, kind: item.kind, text: text || `No text on pages ${from}–${to}.`, pages: last }
  }

  async thatText(folder: string, id: string): Promise<ThatText> {
    const anchor = await this.anchors.read(folder, id)
    const thread = threadOf(anchor.itemId)
    const item = thread ? { title: await this.knownThread(folder, thread).catch(() => 'A thread no longer here') } : await this.library.read(folder, anchor.itemId).catch(() => undefined)
    return { id, item: anchor.itemId, source: item?.title ?? 'A source no longer here', label: anchor.label, ...(anchor.snapshot.text ? { quote: anchor.snapshot.text } : {}) }
  }

  /** The agent points at words on a PDF page: a *that.* made by the agent, found the way the page's own text has it. */
  async agentThat(folder: string, itemId: string, page: number, quote: string): Promise<ThatView> {
    await this.readForSearch(folder, itemId)
    const text = this.index.pages(folder, itemId).find((entry) => entry.page === page)?.text
    if (!text) throw new Error(`Page ${page} has no text to point at.`)
    const words = quote.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const found = words.length > 0 ? new RegExp(words.join('\\s*')).exec(text) : null
    if (!found) throw new Error(`Those words are not on page ${page}. Copy them exactly from read_item.`)
    const selectors = [pageSelector(page), ...textSelectors(text, found.index, found.index + found[0].length)]
    const item = await this.library.read(folder, itemId)
    return thatView(await this.anchors.make(folder, { itemId, selectors, text: found[0], ...sectionLabel(item, page) }, 'agent'))
  }

  /** The agent proposes a change; it waits in pencil. */
  async propose(folder: string, change: ProposalChange, options: { why?: string; asked?: string; thread?: string }): Promise<ProposalView> {
    if (change.kind === 'note' && change.note !== undefined) await this.notes.read(folder, change.note)
    return this.proposalView(folder, await this.proposals.make(folder, change, options))
  }

  /** The open project's proposals, oldest first. */
  async proposalList(): Promise<ProposalView[]> {
    const { open } = await this.state()
    if (!open) return []
    const all = await this.proposals.list(open.project)
    return Promise.all(all.map((proposal) => this.proposalView(open.project, proposal)))
  }

  /**
   * The person accepts or dismisses a proposal. Accepting writes it: a new
   * note, words added at the end of a note, or a linked source.
   */
  async decideProposal(id: unknown, accept: unknown): Promise<{ proposal: ProposalView; item?: ItemView }> {
    if (typeof id !== 'string' || typeof accept !== 'boolean') throw new Error('That is not a decision.')
    const folder = await this.openFolder()
    let item: ItemView | undefined
    const decided = await this.proposals.decide(folder, id, accept ? 'accepted' : 'dismissed', async (change) => {
      item = await this.apply(folder, change)
      return item.id
    })
    return { proposal: await this.proposalView(folder, decided), ...(item ? { item } : {}) }
  }

  private async apply(folder: string, change: ProposalChange): Promise<ItemView> {
    if (change.kind === 'source') return itemView(await this.library.addLink(folder, change.url, 'agent'))
    const added = fromMarkdown(change.text)
    if (change.note === undefined) return noteItem(await this.notes.create(folder, added, 'agent'), await this.citedItems(folder))
    const before = await this.notes.read(folder, change.note)
    const saved = await this.notes.save(folder, change.note, { ...before.doc, content: [...before.doc.content, ...added.content] }, 'agent')
    return noteItem(saved, await this.citedItems(folder))
  }

  private async proposalView(folder: string, proposal: Proposal): Promise<ProposalView> {
    const { change } = proposal
    const target = change.kind === 'note' && change.note !== undefined ? await this.notes.read(folder, change.note).catch(() => undefined) : undefined
    return { ...proposal, ...(target ? { target: target.title } : {}) }
  }

  /** Lets go of the search index (tests, quitting). */
  close(): void {
    this.index.close()
  }

  async addLink(url: string): Promise<ItemView> {
    return itemView(await this.library.addLink(await this.openFolder(), url))
  }

  async itemBytes(id: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(await this.library.filePath(await this.openFolder(), id)))
  }

  /** A stored file read as text (Markdown and the like), in sections. */
  async document(id: string, folder?: string): Promise<ReadingDocument> {
    const where = folder ?? (await this.openFolder())
    const item = await this.library.read(where, id)
    if (item.source.storage !== 'stored' || !isDocumentFile(item.source.file)) throw new Error('That source is not read as text.')
    return readDocument(new Uint8Array(await readFile(await this.library.filePath(where, id))), item.source.file, item.title)
  }

  async readAt(id: string): Promise<ReadingPosition | null> {
    return (await this.library.read(await this.openFolder(), id)).readAt ?? null
  }

  async saveReadAt(id: string, at: unknown): Promise<void> {
    if (!isReadingPosition(at)) throw new Error('That is not a place in a book.')
    await this.library.setReadAt(await this.openFolder(), id, at)
  }

  /** Keeps a page of a book or paper as a bookmark, or lets it go (`label` null). */
  async setBookmark(id: string, page: unknown, label: unknown): Promise<ItemView> {
    if (typeof page !== 'number' || !Number.isFinite(page) || page < 1) throw new Error('That is not a page.')
    if (label !== null && typeof label !== 'string') throw new Error('A bookmark is known by a few words.')
    return itemView(await this.library.setBookmark(await this.openFolder(), id, page, label))
  }

  /** A web page's last snapshot (PNG bytes), if it has one. */
  async snapshot(id: string): Promise<Uint8Array | null> {
    const path = this.library.snapshotPath(await this.openFolder(), id)
    return readFile(path).then(
      (bytes) => new Uint8Array(bytes),
      () => null,
    )
  }

  async saveSnapshot(id: string, png: Uint8Array): Promise<void> {
    const path = this.library.snapshotPath(await this.openFolder(), id)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, png)
  }

  /**
   * A web page told us its title. It replaces the name made from the link,
   * but never a name already changed.
   */
  async pageTitle(id: string, title: string): Promise<ItemView | undefined> {
    const folder = await this.openFolder()
    const item = await this.library.read(folder, id)
    if (item.source.storage !== 'linked' || item.title !== titleFromUrl(new URL(item.source.url))) return undefined
    return itemView(await this.library.setTitle(folder, id, title))
  }

  /** A *that.* from the renderer or a live page: checked, turned into selectors, kept. */
  async makeThat(request: unknown): Promise<ThatView> {
    if (typeof request !== 'object' || request === null) throw new Error('That is not a place in a source.')
    const { itemId, page, text, seconds, region, image } = request as Record<string, unknown>
    if (typeof itemId !== 'string') throw new Error('That is not a place in a source.')
    const folder = await this.openFolder()
    const item = await this.library.read(folder, itemId)
    const selectors: Selector[] = []
    if (page !== undefined) selectors.push(pageSelector(Number(page)))
    let quoted: string | undefined
    if (text !== undefined) {
      const { source, start, end } = (text ?? {}) as Record<string, unknown>
      if (typeof source !== 'string' || typeof start !== 'number' || typeof end !== 'number') throw new Error('That selection is not in the text.')
      selectors.push(...textSelectors(source, start, end))
      quoted = source.slice(start, end)
    }
    if (seconds !== undefined) selectors.push(momentSelector(Number(seconds)))
    if (region !== undefined) {
      const { x, y, w, h } = (region ?? {}) as Record<string, unknown>
      selectors.push(regionSelector({ x: Number(x), y: Number(y), w: Number(w), h: Number(h) }))
    }
    const png = image instanceof Uint8Array ? image : undefined
    return thatView(await this.anchors.make(folder, { itemId, selectors, ...(quoted ? { text: quoted } : {}), ...(png ? { image: png } : {}), ...(page !== undefined ? sectionLabel(item, Number(page)) : {}) }))
  }

  /**
   * A *that.* on a turn of the project thread: something the agent (or you)
   * said, kept with its words. A turn already pointed at keeps its one *that.*
   */
  async thatTurn(turnId: unknown, thread: string = PROJECT_THREAD): Promise<ThatView> {
    if (typeof turnId !== 'string') throw new Error('That is not a turn.')
    const folder = await this.openFolder()
    await this.knownThread(folder, thread)
    const known = (await this.anchors.list(folder, threadItem(thread))).find((anchor) => turnOf(anchor.selectors) === turnId)
    if (known) return thatView(known)
    const turn = (await this.threads.turns(folder, thread)).find((candidate) => candidate.id === turnId)
    if (!turn) throw new Error('That turn is not in the thread.')
    return thatView(await this.anchors.make(folder, { itemId: threadItem(thread), selectors: [turnSelector(turn.id)], text: turn.text }))
  }

  /** A thread's title: the project thread, or a side thread of this project. */
  private async knownThread(folder: string, thread: string): Promise<string> {
    if (thread === PROJECT_THREAD) return 'Project thread'
    const side = (await this.threads.sides(folder)).find((candidate) => candidate.id === thread)
    if (!side) throw new Error('That side thread is not in this project.')
    return side.title
  }

  /**
   * Adds a turn to a note, as you would by copying it: its words, then a
   * chip back to the turn. With no note given, it starts a new one.
   */
  async addTurnToNote(turnId: unknown, noteId: unknown, thread: string = PROJECT_THREAD): Promise<ItemView> {
    if (noteId !== undefined && typeof noteId !== 'string') throw new Error('That is not a note.')
    const that = await this.thatTurn(turnId, thread)
    const folder = await this.openFolder()
    const added = fromMarkdown(`${that.text ?? ''}\n\n[${that.label}](that:${that.id})`).content
    if (noteId === undefined) {
      // A new note is titled with the question the turn answered.
      const turns = await this.threads.turns(folder, thread)
      const at = turns.findIndex((turn) => turn.id === turnId)
      const asked = turns.slice(0, at).findLast((turn) => turn.by === 'user')?.text.replace(/\s+/g, ' ').trim()
      const title = !asked ? 'From the project thread' : asked.length > 80 ? `${asked.slice(0, 79).trimEnd()}…` : asked
      const doc = fromMarkdown(`# ${title}`)
      return noteItem(await this.notes.create(folder, { type: 'doc', content: [...doc.content, ...added] }), await this.citedItems(folder))
    }
    const before = await this.notes.read(folder, noteId)
    const saved = await this.notes.save(folder, noteId, { ...before.doc, content: [...before.doc.content, ...added] })
    return noteItem(saved, await this.citedItems(folder))
  }

  async thats(): Promise<ThatView[]> {
    const { open } = await this.state()
    return open ? (await this.anchors.list(open.project)).map(thatView) : []
  }

  async thatImage(id: string): Promise<Uint8Array | null> {
    const path = await this.anchors.imagePath(await this.openFolder(), id)
    return path ? new Uint8Array(await readFile(path)) : null
  }

  private async openFolder(): Promise<string> {
    const { open } = await this.state()
    if (!open) throw new Error('Create a project first.')
    return open.project
  }

  private async remember(project: string, desk: string | undefined): Promise<void> {
    const settings = await this.workspace.readSettings()
    const desks = desk === undefined ? settings.desks : { ...settings.desks, [project]: desk }
    await this.workspace.writeSettings({ ...settings, project, ...(desks ? { desks } : {}) })
  }
}

function summary(opened: OpenProject, desk: string | undefined): NonNullable<ShellState['open']> {
  return {
    project: opened.folder,
    desks: opened.desks.map(({ id, name }) => ({ id, name })),
    desk: desk ?? '',
  }
}

/** A *that.* in a document read as text names its section ("§3"), not a page. */
function sectionLabel(item: ItemFile, section: number): { label?: string } {
  return item.source.storage === 'stored' && isDocumentFile(item.source.file) ? { label: `§${section}` } : {}
}

function itemView(item: ItemFile): ItemView {
  const base = { id: item.id, kind: item.kind, title: item.title, createdBy: item.createdBy, createdAt: item.createdAt }
  if (item.source.storage === 'linked') return { ...base, url: item.source.url }
  const bookmarks = item.bookmarks?.map(({ page, label }) => ({ page, label }))
  return { ...base, file: { name: item.source.file, size: item.source.size }, ...(bookmarks ? { bookmarks } : {}) }
}

/** A kit's sheets as items: "kit:language:stages", each served from the kit's own origin. */
function kitSheets(kit: KitManifest): ItemView[] {
  return kit.sheets.map((sheet) => ({
    id: `kit:${kit.name}:${sheet.id}`,
    kind: 'kit',
    title: sheet.title,
    kit: { name: kit.name, title: kit.title, sheet: sheet.id, url: `${kitOrigin(kit.name)}/${sheet.file}?sheet=${encodeURIComponent(sheet.id)}`, size: sheet.size },
  }))
}

function noteItem(note: NoteSummary, sources: ReadonlyMap<string, string>): ItemView {
  // Turns of a thread are not sources.
  const cites = [...new Set(note.cites.flatMap((that) => (sources.has(that) && !threadOf(sources.get(that)!) ? [sources.get(that)!] : [])))]
  return { id: note.id, kind: 'note', title: note.title, folder: note.folder, name: note.name, links: note.links, pinned: note.pinned, updatedAt: note.updatedAt, tags: note.tags, cites, createdBy: note.createdBy, createdAt: note.createdAt }
}

function noteView(note: NoteFile): NoteView {
  return { id: note.id, title: note.title, doc: note.doc, updatedAt: note.updatedAt }
}

function thatView(anchor: AnchorFile): ThatView {
  return {
    id: anchor.id,
    itemId: anchor.itemId,
    label: anchor.label,
    selectors: anchor.selectors,
    ...(anchor.snapshot.text ? { text: anchor.snapshot.text } : {}),
    image: anchor.snapshot.image !== undefined,
    createdAt: anchor.createdAt,
  }
}

function view(desk: DeskFile): DeskView {
  return { id: desk.id, name: desk.name, sheets: desk.sheets, viewport: desk.viewport }
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function isSheet(value: unknown): value is Sheet {
  if (typeof value !== 'object' || value === null) return false
  const sheet = value as Record<string, unknown>
  return (
    typeof sheet.id === 'string' &&
    (sheet.itemId === null || typeof sheet.itemId === 'string') &&
    finite(sheet.x) &&
    finite(sheet.y) &&
    finite(sheet.w) &&
    finite(sheet.h) &&
    finite(sheet.scale) &&
    sheet.scale >= 0.3 &&
    sheet.scale <= 1 &&
    finite(sheet.z) &&
    (sheet.pile === undefined || typeof sheet.pile === 'string') &&
    (sheet.folded === undefined || sheet.folded === true) &&
    (sheet.pageZoom === undefined || (finite(sheet.pageZoom) && sheet.pageZoom >= 0.25 && sheet.pageZoom <= 3))
  )
}

function isReadingPosition(value: unknown): value is ReadingPosition {
  if (typeof value !== 'object' || value === null) return false
  const at = value as Record<string, unknown>
  return finite(at.page) && at.page >= 1 && finite(at.offset)
}

function isViewport(value: unknown): value is Viewport {
  if (typeof value !== 'object' || value === null) return false
  const viewport = value as Record<string, unknown>
  return finite(viewport.x) && finite(viewport.y) && finite(viewport.zoom) && viewport.zoom >= 0.25 && viewport.zoom <= 2
}

function isChange(value: unknown): value is SheetChange {
  if (typeof value !== 'object' || value === null) return false
  const change = value as Record<string, unknown>
  return (
    typeof change.kind === 'string' &&
    /^[a-z-]+$/.test(change.kind) &&
    Array.isArray(change.ids) &&
    change.ids.every((id) => typeof id === 'string')
  )
}
