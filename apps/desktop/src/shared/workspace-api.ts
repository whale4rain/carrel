// What the renderer sees of projects and desks, and how it asks for changes.
// Main owns the files; the renderer only gets summaries back.
import type { ItemKind, NoteDoc, NoteViewSpec, PropertyValue, ReadingPosition, Selector, Sheet, SheetChange, Viewport } from '@carrel/core'

export type { ItemKind, NoteDoc, NoteViewSpec, PropertyValue, ReadingPosition, Selector, Sheet, SheetChange, Viewport }

/** What can sit on a sheet: a source, or a note. */
export type ViewKind = ItemKind | 'note' | 'kit'

/** A source or a note in the open project, as the renderer sees it. */
export interface ItemView {
  id: string
  kind: ViewKind
  title: string
  /** Notes: when it last changed. */
  updatedAt?: string
  /** Notes: the folder it is filed in ("" for none, "a/b" when nested). */
  folder?: string
  /** Notes: its file's name without ".md", which [[links]] may use instead of its title. */
  name?: string
  /** Notes: the notes it links to, by name as written. */
  links?: string[]
  /** Notes: kept at the top of the sidebar. */
  pinned?: boolean
  /** Notes: its properties (status, dates, lists), in the order its header has them. */
  properties?: Record<string, PropertyValue>
  /** Notes: its #tags, lower-cased. */
  tags?: string[]
  /** Notes: the items its *that.* chips point into. */
  cites?: string[]
  /** Linked items: the address. */
  url?: string
  /** Stored items: the file's name and size in bytes. */
  file?: { name: string; size: number }
  /** Books and papers: pages kept to come back to, in page order. */
  bookmarks?: Array<{ page: number; label: string }>
  /** A kit's sheet: which kit and sheet, where its page is served, and its size at 100%. */
  kit?: { name: string; title: string; sheet: string; url: string; size: { w: number; h: number } }
  /** Who added it, and when. */
  createdBy?: 'user' | 'agent'
  createdAt?: string
}

/** A learning kit installed on this computer. */
export interface KitView {
  name: string
  title: string
  description: string
  sheets: Array<{ id: string; title: string }>
  /** Whether the open project uses it already. */
  added: boolean
  /** What it asks for beyond its own store that the person hasn't allowed yet, in words. */
  asks: string[]
}

/** A note, with its text as the editor's document. */
export interface NoteView {
  id: string
  title: string
  doc: NoteDoc
  updatedAt: string
}

/** A note that links to or names another, with the words around it. */
export interface MentionView {
  id: string
  title: string
  folder: string
  snippet: string
}

/** A *that.*: where it points, as its chip shows it. */
export interface ThatView {
  id: string
  itemId: string
  /** "p.42", "12:34", or empty for a web page. */
  label: string
  /** Where it points, to find it again. */
  selectors: Selector[]
  /** The quoted words, if it points at text. */
  text?: string
  /** Whether a snapshot image (a video frame) was kept. */
  image: boolean
  createdAt: string
}

/**
 * What the renderer asks to point at. Text is given with the text it sits in
 * (for a PDF, its page's), so main can build the selectors.
 */
export interface ThatRequest {
  itemId: string
  page?: number
  text?: { source: string; start: number; end: number }
  /** A moment in a video, in seconds. */
  seconds?: number
  /** A box, in percent of the page (for a PDF) or of the sheet's source. */
  region?: { x: number; y: number; w: number; h: number }
  /** A PNG of what it points at. */
  image?: Uint8Array
}

/** One search result. */
export interface SearchHitView {
  /** A note, a source (by its title), a *that.*, or a page of a PDF. */
  kind: 'note' | 'source' | 'that' | 'page'
  /** The note, item or *that.* it found. */
  id: string
  /** The source a page or a *that.* is in. */
  itemId?: string
  page?: number
  title: string
  /** Words around the match; matches sit between \u0001 and \u0002. */
  snippet: string
}

/** A rectangle in window pixels. */
export interface WindowRect {
  x: number
  y: number
  w: number
  h: number
}

export interface DeskSummary {
  id: string
  name: string
}

export interface ShellState {
  /** Project folder names under ~/Carrel. */
  projects: string[]
  /** The open project and desk, if there is any project. */
  open?: { project: string; desks: DeskSummary[]; desk: string }
}

/** One desk of the open project, with its sheets. */
export interface DeskView {
  id: string
  name: string
  sheets: Sheet[]
  viewport: Viewport
}

export interface WorkspaceApi {
  state(): Promise<ShellState>
  createProject(name: string): Promise<ShellState>
  openProject(name: string): Promise<ShellState>
  createDesk(name: string): Promise<ShellState>
  openDesk(id: string): Promise<ShellState>
  desk(id: string): Promise<DeskView>
  /** Saves a desk's sheets after one gesture; `change` says what it did. */
  saveSheets(id: string, sheets: Sheet[], change: SheetChange): Promise<DeskView>
  /** Remembers where the desk is looked at: pan and zoom. */
  saveViewport(id: string, viewport: Viewport): Promise<DeskView>
  /** The open project's sources and notes. */
  items(): Promise<ItemView[]>
  /** Starts an empty note in the project, in a folder if given, with a title if given. */
  createNote(folder?: string, title?: string): Promise<ItemView>
  /** The notes that link to a note, and those that name it without a link. */
  mentions(id: string): Promise<{ linked: MentionView[]; unlinked: MentionView[] }>
  /** The project's saved views of notes. */
  noteViews(): Promise<NoteViewSpec[]>
  /** A new view showing every note. */
  createView(name: string): Promise<NoteViewSpec>
  /** Writes a view's name, filters, sort, columns or layout. */
  saveView(view: NoteViewSpec): Promise<NoteViewSpec>
  deleteView(id: string): Promise<void>
  /** Sets a note's property, or takes it away (`null`). */
  setProperty(id: string, key: string, value: PropertyValue | null): Promise<ItemView>
  /** Pins a note to the top of the sidebar, or lets it go. */
  pinNote(id: string, pinned: boolean): Promise<ItemView>
  /** Today's note, made if it isn't there yet. */
  dailyNote(): Promise<ItemView>
  /** Turns the first place note `from` names note `to` into a [[link]]. */
  linkMention(from: string, to: string): Promise<ItemView>
  /** The project's note folders, empty ones too ("a", "a/b"). */
  noteFolders(): Promise<string[]>
  /** Makes a note folder; returns its path as kept. */
  createFolder(path: string): Promise<string>
  /** Renames or moves a note folder with its notes; returns its new path. */
  renameFolder(from: string, to: string): Promise<string>
  /** Files a note in another folder ("" for none). */
  moveNote(id: string, folder: string): Promise<ItemView>
  /** A note's text. */
  note(id: string): Promise<NoteView>
  /** Writes a note's text; returns the note, retitled from its first line. */
  saveNote(id: string, doc: NoteDoc): Promise<ItemView>
  /** Searches the open project's notes, sources, *that.*s and PDF pages. */
  search(query: string): Promise<SearchHitView[]>
  /** Asks for PDFs and documents with the system's file dialog; returns their paths, or none if cancelled. */
  chooseFiles(): Promise<string[]>
  /** Copies files (PDFs) into the project as items. */
  addFiles(paths: string[]): Promise<ItemView[]>
  /** Links a web page or video. */
  addLink(url: string): Promise<ItemView>
  /** A stored item's file (a PDF), as bytes. */
  itemBytes(id: string): Promise<Uint8Array>
  /** A web page's last snapshot (PNG), if it has one. */
  snapshot(id: string): Promise<Uint8Array | null>
  /** A stored file read as text (Markdown and the like), in sections. */
  document(id: string): Promise<import('@carrel/core/documents').ReadingDocument>
  /** Where a book or paper was last read, if it has been. */
  readAt(id: string): Promise<ReadingPosition | null>
  /** Remembers where a book or paper is being read. */
  saveReadAt(id: string, at: ReadingPosition): Promise<void>
  /** Keeps a page of a book or paper as a bookmark, or lets it go (`label` null); the item as it is now. */
  setBookmark(id: string, page: number, label: string | null): Promise<ItemView>
  /** A linked source told us its title (a video player does); the item, if renamed. */
  sourceTitle(id: string, title: string): Promise<ItemView | null>
  /** Keeps a *that.* in the project. */
  makeThat(request: ThatRequest): Promise<ThatView>
  /** The project's *that.*s, oldest first. */
  thats(): Promise<ThatView[]>
  /** A *that.*'s snapshot image (PNG), if it has one. */
  thatImage(id: string): Promise<Uint8Array | null>
  /** Takes a *that.* away if nothing uses it; false when a note, question or kit still does. */
  removeThat(id: string): Promise<boolean>
  /** The learning kits installed on this computer. */
  kits(): Promise<KitView[]>
  /** Adds a kit to the open project; its sheets, to lay on the desk. `allow` says yes to what it asks. */
  addKit(name: string, allow?: boolean): Promise<ItemView[]>
  /** A kit page's call through its bridge: `kit.store.get(...)` is method "store.get". */
  kitCall(name: string, method: string, args: unknown[]): Promise<unknown>
}

/** The desk's web pages, drawn by main over their sheets. */
export interface WebApi {
  /** Where the web sheets are now; main decides which one is live. */
  layout(layout: unknown): void
  onLive(listener: (sheet: string | null) => void): () => void
  onSnapshot(listener: (sheet: string, itemId: string, png: Uint8Array) => void): () => void
  /** An item changed in main (a page told us its title). */
  onItem(listener: (item: ItemView) => void): () => void
  /** A *that.* made inside a live page (⌘. there goes to the page, not the desk). */
  onThat(listener: (that: ThatView) => void): () => void
  /** What the window shows in a rectangle, as a PNG: a video's frame. */
  frame(rect: WindowRect): Promise<Uint8Array>
  /** Opens a *that.* in its live page: scrolls to it and marks it. */
  showThat(sheet: string, that: string): void
  /** Whether a *that.* was found in its page as it is now. */
  onFound(listener: (that: string, found: boolean) => void): () => void
  /**
   * An app shortcut pressed while a live page had the keyboard: "k" (search),
   * "j" (the agent), or "=", "-", "0" (the page's zoom).
   */
  onShortcut(listener: (key: string) => void): () => void
  /** A web sheet's page started or stopped loading, or failed to load (with why). */
  onLoading(listener: (sheet: string, state: WebLoading) => void): () => void
  /** How much the live page must shrink to fit its sheet's width (1 when it fits). */
  fitWidth(sheet: string): Promise<number>
  /** Loads the sheet's page again. */
  reload(sheet: string): void
  /** Right-clicked words in a live page, made a *that.*, to ask the agent about. */
  onAsk(listener: (ask: import('./menu.js').AgentAsk, that: ThatView) => void): () => void
}

export type WebLoading = { loading: boolean; error?: string }

export const workspaceChannels = {
  state: 'workspace:state',
  createProject: 'workspace:create-project',
  openProject: 'workspace:open-project',
  createDesk: 'workspace:create-desk',
  openDesk: 'workspace:open-desk',
  desk: 'workspace:desk',
  saveSheets: 'workspace:save-sheets',
  saveViewport: 'workspace:save-viewport',
  items: 'workspace:items',
  createNote: 'workspace:create-note',
  noteFolders: 'workspace:note-folders',
  createFolder: 'workspace:create-folder',
  renameFolder: 'workspace:rename-folder',
  moveNote: 'workspace:move-note',
  mentions: 'workspace:mentions',
  linkMention: 'workspace:link-mention',
  pinNote: 'workspace:pin-note',
  setProperty: 'workspace:set-property',
  noteViews: 'workspace:note-views',
  createView: 'workspace:create-view',
  saveView: 'workspace:save-view',
  deleteView: 'workspace:delete-view',
  dailyNote: 'workspace:daily-note',
  note: 'workspace:note',
  saveNote: 'workspace:save-note',
  search: 'workspace:search',
  chooseFiles: 'workspace:choose-files',
  addFiles: 'workspace:add-files',
  addLink: 'workspace:add-link',
  itemBytes: 'workspace:item-bytes',
  snapshot: 'workspace:snapshot',
  document: 'workspace:document',
  readAt: 'workspace:read-at',
  saveReadAt: 'workspace:save-read-at',
  setBookmark: 'workspace:set-bookmark',
  sourceTitle: 'workspace:source-title',
  makeThat: 'workspace:make-that',
  thats: 'workspace:thats',
  thatImage: 'workspace:that-image',
  removeThat: 'workspace:remove-that',
  kits: 'workspace:kits',
  addKit: 'workspace:add-kit',
  kitCall: 'workspace:kit-call',
} as const satisfies Record<keyof WorkspaceApi, string>

/** Replies over IPC carry the error message instead of throwing, so it reaches the renderer intact. */
export type WorkspaceReply = { value: unknown } | { error: string }
