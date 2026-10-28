import { ChatSync, dayOf, DEFAULT_SETTINGS, Kept, memoryPaths, onTrail, readChatGptExport, readSettings, visitKey, writeSettings, type MemoryPaths, type MemorySettings } from '@carrel/memory'
import type { CarrelRoots } from '@carrel/core'
import { BrowserWindow, clipboard, desktopCapturer, dialog, globalShortcut, ipcMain, screen } from 'electron'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { memoryChannels, type KeepChoice, type KeptToday, type MemorySettingsView } from '../shared/memory-api.js'
import type { WorkspaceReply } from '../shared/workspace-api.js'
import { captureFor, offerOf, type Gathered } from './keep.js'

/** How often chats are read again while Carrel runs. */
const SYNC_MS = 5 * 60_000
/** Pages on the trail shorter than this are not worth keeping (a login wall, an empty app shell). */
const VISIT_MIN_TEXT = 200

export interface MemoryServiceOptions {
  roots: CarrelRoots
  /** tnega's home, whose sessions are kept. */
  tnegaHome?: string
  /** The page live in Carrel's main window, for Keep. */
  livePage: () => Promise<{ url: string; title: string; text: string; selection?: string } | undefined>
  /** Opens the Keep window's page. */
  keepUrl: () => string
  /** The window options for the Keep window. */
  preload: string
}

/**
 * Memory in main: keeps your chats in the background, the Keep shortcut
 * (⌘⇧K / Ctrl+Shift+K, from anywhere on the computer), the reading trail,
 * and the ChatGPT import.
 */
export class MemoryService {
  readonly paths: MemoryPaths
  readonly kept: Kept
  private readonly chats: ChatSync
  private settings: Promise<MemorySettings>
  /** Settings saves, one at a time, so each reads what the one before it wrote. */
  private settingsWrites: Promise<unknown> = Promise.resolve()
  private syncing: Promise<number> = Promise.resolve(0)
  private timer: ReturnType<typeof setInterval> | undefined
  private keepWindow: BrowserWindow | undefined
  private gathered: Gathered = {}
  private screenshot: string | undefined
  /** Trail visits kept since Carrel started, so a page read twice in a day is kept once. */
  private readonly visits = new Set<string>()

  constructor(private readonly options: MemoryServiceOptions) {
    this.paths = memoryPaths(options.roots)
    this.kept = new Kept(this.paths)
    this.chats = new ChatSync(this.kept, {
      tnegaHome: options.tnegaHome ?? tnegaHome(),
      content: options.roots.content,
      cursorFile: join(this.paths.internal, 'chats.json'),
    })
    this.settings = readSettings(this.paths).catch(() => ({ ...DEFAULT_SETTINGS }))
  }

  /** Starts keeping chats in the background and takes the Keep shortcut. */
  start(): void {
    setTimeout(() => void this.syncChats(), 3000)
    this.timer = setInterval(() => void this.syncChats(), SYNC_MS)
    const taken = globalShortcut.register('CommandOrControl+Shift+K', () => void this.openKeep())
    if (!taken) console.error('Keep: ⌘⇧K is taken by another app.')
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    globalShortcut.unregister('CommandOrControl+Shift+K')
    await this.syncChats()
  }

  /** Reads tnega's sessions and Carrel's threads for what changed. */
  syncChats(): Promise<number> {
    this.syncing = this.syncing.then(
      () => this.chats.sync(),
      () => this.chats.sync(),
    )
    const run = this.syncing.then((added) => {
      if (added > 0) this.told()
      return added
    })
    run.catch((error: unknown) => console.error('memory: keeping chats:', error))
    return run.catch(() => 0)
  }

  /** The reading trail: a page read in Carrel, kept when its site is on the trail. */
  async visited(url: string, title: string, text: () => Promise<string>): Promise<void> {
    const { trail } = await this.settings
    if (trail.length === 0 || !onTrail(url, trail)) return
    const key = `visit:${visitKey(url)}:${dayOf(new Date())}`
    if (this.visits.has(key)) return
    const words = (await text()).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim()
    if (words.length < VISIT_MIN_TEXT) return
    this.visits.add(key)
    await this.kept.add({ key, kind: 'visit', from: 'trail', title: title || url, text: words, url: visitKey(url) })
    this.told()
  }

  /** Gathers what can be kept now, then shows the Keep window over whatever you were doing. */
  async openKeep(): Promise<void> {
    const [page, screen] = await Promise.all([this.options.livePage().catch(() => undefined), screenshot()])
    const copied = await Promise.resolve(clipboard.readText()).catch(() => '')
    this.gathered = {
      ...(page ? { page: { url: page.url, title: page.title, text: page.text } } : {}),
      ...(page?.selection ? { selection: page.selection } : {}),
      ...(copied ? { copied } : {}),
      ...(screen ? { screen: screen.png } : {}),
    }
    this.screenshot = screen?.preview
    if (this.keepWindow && !this.keepWindow.isDestroyed()) {
      this.keepWindow.webContents.reload()
      this.keepWindow.show()
      this.keepWindow.focus()
      return
    }
    const window = new BrowserWindow({
      width: 460,
      height: 440,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      show: false,
      title: 'Keep',
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : { autoHideMenuBar: true }),
      webPreferences: { preload: this.options.preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    window.once('ready-to-show', () => window.show())
    window.on('closed', () => {
      if (this.keepWindow === window) this.keepWindow = undefined
    })
    this.keepWindow = window
    await window.loadURL(this.options.keepUrl())
  }

  async keep(choice: KeepChoice, reason: string): Promise<void> {
    const image = choice === 'screenshot' && this.gathered.screen ? await this.kept.saveImage(this.gathered.screen) : undefined
    await this.kept.add(captureFor(choice, this.gathered, reason, image))
    this.gathered = {}
    this.screenshot = undefined
    this.told()
  }

  closeKeep(): void {
    this.keepWindow?.close()
  }

  async today(): Promise<KeptToday> {
    const captures = await this.kept.day(dayOf(new Date()))
    const onPurpose = captures.filter((capture) => capture.from === 'keep')
    return {
      chats: captures.filter((capture) => capture.kind === 'chat').length,
      visits: captures.filter((capture) => capture.kind === 'visit').length,
      kept: onPurpose.length,
      latest: onPurpose
        .slice(-3)
        .reverse()
        .map((capture) => ({ kind: capture.kind, title: capture.title })),
    }
  }

  async readSettings(): Promise<MemorySettingsView> {
    return this.settings
  }

  async saveSettings(settings: Partial<MemorySettingsView>): Promise<MemorySettingsView> {
    const clean: Partial<MemorySettings> = {}
    if (Array.isArray(settings.trail)) clean.trail = settings.trail.filter((site): site is string => typeof site === 'string').slice(0, 100)
    if (typeof settings.eveningHour === 'number') clean.eveningHour = settings.eveningHour
    const save = this.settingsWrites.then(() => writeSettings(this.paths, clean))
    this.settingsWrites = save.catch(() => undefined)
    const saved = await save
    this.settings = Promise.resolve(saved)
    return saved
  }

  /** Asks for a ChatGPT export (conversations.json or the .zip) and keeps what's in it. */
  async importChatGpt(window: BrowserWindow | undefined): Promise<{ conversations: number; kept: number } | null> {
    // Checks stand in for the person at the file dialog.
    let file = process.env.CARREL_CHATGPT_EXPORT
    if (!file) {
      const options = { title: 'Import a ChatGPT export', properties: ['openFile' as const], filters: [{ name: 'ChatGPT export', extensions: ['zip', 'json'] }] }
      const chosen = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      if (chosen.canceled || !chosen.filePaths[0]) return null
      file = chosen.filePaths[0]
    }
    const conversations = readChatGptExport(await readFile(file))
    // After any sync running now, and before the next, so their cursors don't overwrite each other.
    const run = this.syncing.then(
      () => this.chats.keepConversations(conversations),
      () => this.chats.keepConversations(conversations),
    )
    this.syncing = run.catch(() => 0)
    const kept = await run
    if (kept > 0) this.told()
    return { conversations: conversations.length, kept }
  }

  /** Tells every window something was kept. */
  private told(): void {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(memoryChannels.kept)
  }

  /** The renderer's memory calls. */
  serve(): void {
    const handle = (channel: string, run: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>): void => {
      ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<WorkspaceReply> => {
        try {
          return { value: await run(event, ...args) }
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) }
        }
      })
    }
    handle(memoryChannels.openKeep, () => this.openKeep())
    handle(memoryChannels.offer, async () => offerOf(this.gathered, this.screenshot))
    handle(memoryChannels.keep, async (_event, choice, reason) => {
      if (choice !== 'page' && choice !== 'selection' && choice !== 'copied' && choice !== 'screenshot') throw new Error('Keep what?')
      await this.keep(choice, typeof reason === 'string' ? reason.slice(0, 500) : '')
    })
    ipcMain.on(memoryChannels.closeKeep, () => this.closeKeep())
    handle(memoryChannels.today, () => this.today())
    handle(memoryChannels.settings, () => this.readSettings())
    handle(memoryChannels.saveSettings, async (_event, settings) => this.saveSettings(typeof settings === 'object' && settings !== null ? (settings as Partial<MemorySettingsView>) : {}))
    handle(memoryChannels.importChatGpt, (event) => this.importChatGpt(BrowserWindow.fromWebContents(event.sender) ?? undefined))
  }
}

/** tnega's home: `TNEGA_HOME`, or ~/.tnega. */
function tnegaHome(): string {
  const configured = process.env.TNEGA_HOME?.trim()
  if (!configured) return join(homedir(), '.tnega')
  if (configured === '~') return homedir()
  if (configured.startsWith('~/') || configured.startsWith('~\\')) return join(homedir(), configured.slice(2))
  return resolve(configured)
}

/** The screen under the pointer, as a PNG and a small preview. Undefined when it can't be taken (no permission, no screen). */
async function screenshot(): Promise<{ png: Uint8Array; preview: string } | undefined> {
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) }
    const sources = await Promise.race([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('timed out')), 2000)),
    ])
    const source = sources.find((entry) => entry.display_id === String(display.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) return undefined
    return { png: source.thumbnail.toPNG(), preview: source.thumbnail.resize({ width: 400 }).toDataURL() }
  } catch {
    return undefined
  }
}
