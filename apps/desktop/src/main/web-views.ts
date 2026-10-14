import { pickLive, type LiveBlocker, type LiveSheet, type Rect } from '@carrel/desk'
import { shell, WebContentsView, type BrowserWindow } from 'electron'

/** A web sheet as the renderer lays it out, in window pixels. */
export interface WebSheetLayout extends LiveSheet {
  itemId?: string
  url?: string
  /** The page's zoom: the sheet's scale times the desk's zoom. */
  zoom: number
}

export interface WebLayout {
  sheets: WebSheetLayout[]
  active: string | undefined
  moving: boolean
  desk: Rect
  overlays: Rect[]
}

export interface WebHooks {
  /** Keeps a web page's latest snapshot with its item. */
  saveSnapshot(itemId: string, png: Buffer): Promise<void>
  /** The page told us its title. */
  title(itemId: string, title: string): void
}

/** Web pages get their own session: their cookies and logins stay apart from the desk's. */
const WEB_PARTITION = 'persist:web'

/** Live views kept loaded besides the live one, so switching back is quick. */
const KEEP = 2
/** How often the live page's snapshot is refreshed, so leaving never waits. */
const REFRESH_MS = 2000

interface Page {
  view: WebContentsView
  itemId: string
  url: string
  /** The sheet's zoom, kept across loads. */
  zoom: number
  usedAt: number
}

/**
 * The desk's web pages: native WebContentsViews over their sheets, at most
 * one shown at a time (the one-live-view rule, `pickLive`). A page that stops
 * being live is captured first, and its sheet shows that snapshot.
 */
export class WebViews {
  private readonly pages = new Map<string, Page>()
  private live: string | undefined
  private refresh: ReturnType<typeof setInterval> | undefined
  private queue: Promise<void> = Promise.resolve()
  private next: WebLayout | undefined
  private reason: LiveBlocker | undefined

  constructor(
    private readonly window: BrowserWindow,
    private readonly hooks: WebHooks,
  ) {}

  /** Which sheet is live, or why none is. */
  get status(): { live: string | undefined; reason: LiveBlocker | undefined } {
    return { live: this.live, reason: this.reason }
  }

  /** Layouts apply in order; the newest one waiting replaces older ones. */
  layout(layout: WebLayout): Promise<void> {
    const queued = this.next !== undefined
    this.next = layout
    if (!queued) {
      this.queue = this.queue.then(async () => {
        const latest = this.next
        this.next = undefined
        if (latest) await this.apply(latest).catch((error: unknown) => console.error('web views:', error))
      })
    }
    return this.queue
  }

  private async apply(layout: WebLayout): Promise<void> {
    const decision = pickLive(layout)
    this.reason = 'reason' in decision ? decision.reason : undefined
    const present = new Set(layout.sheets.map((sheet) => sheet.id))

    if (this.live && this.live !== decision.live) {
      // A drag can't wait for a capture, so it uses the last refresh.
      const leaving = this.live
      if (this.reason === 'moving') this.hide(leaving)
      else {
        await this.capture(leaving, true)
        this.hide(leaving)
      }
    }
    // Sheets that left the desk lose their page.
    for (const id of [...this.pages.keys()]) if (!present.has(id)) this.close(id)

    const sheet = decision.live ? layout.sheets.find((entry) => entry.id === decision.live) : undefined
    if (sheet?.url && sheet.itemId) {
      const page = this.open(sheet.id, sheet.itemId, sheet.url)
      page.view.setBounds(bounds(sheet.page))
      page.zoom = Math.max(0.25, Math.min(2, sheet.zoom))
      page.view.webContents.setZoomFactor(page.zoom)
      page.usedAt = Date.now()
      if (this.live !== sheet.id) {
        page.view.setVisible(true)
        this.live = sheet.id
        this.send('web:live', { sheet: sheet.id })
        this.startRefreshing(sheet.id)
      }
    }
    this.trim()
  }

  private open(id: string, itemId: string, url: string): Page {
    const known = this.pages.get(id)
    if (known && known.url === url) return known
    if (known) this.close(id)
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: WEB_PARTITION } })
    view.setVisible(false)
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:/.test(target)) void shell.openExternal(target)
      return { action: 'deny' }
    })
    view.webContents.on('page-title-updated', (_event, title) => this.hooks.title(itemId, title))
    // Loading a page resets its zoom, so the sheet's is put back.
    view.webContents.on('did-finish-load', () => view.webContents.setZoomFactor(page.zoom))
    this.window.contentView.addChildView(view)
    void view.webContents.loadURL(url).catch(() => undefined)
    const page: Page = { view, itemId, url, zoom: 1, usedAt: Date.now() }
    this.pages.set(id, page)
    return page
  }

  private hide(id: string): void {
    this.pages.get(id)?.view.setVisible(false)
    if (this.live === id) {
      this.live = undefined
      this.stopRefreshing()
      this.send('web:live', { sheet: null })
    }
  }

  private close(id: string): void {
    this.hide(id)
    const page = this.pages.get(id)
    if (!page) return
    this.window.contentView.removeChildView(page.view)
    page.view.webContents.close()
    this.pages.delete(id)
  }

  /** Keeps the live page and the few most recently used; the rest show snapshots only. */
  private trim(): void {
    const idle = [...this.pages.entries()].filter(([id]) => id !== this.live).sort((a, b) => b[1].usedAt - a[1].usedAt)
    for (const [id] of idle.slice(KEEP)) this.close(id)
  }

  private async capture(id: string, keep: boolean): Promise<void> {
    const page = this.pages.get(id)
    if (!page) return
    // A view that has never been on screen has no surface, and the capture rejects.
    const image = await page.view.webContents.capturePage().catch(() => undefined)
    if (!image || image.isEmpty()) return
    const png = image.toPNG()
    this.send('web:snapshot', { sheet: id, itemId: page.itemId, png })
    if (keep) await this.hooks.saveSnapshot(page.itemId, png).catch(() => undefined)
  }

  private startRefreshing(id: string): void {
    this.stopRefreshing()
    this.refresh = setInterval(() => void this.capture(id, false), REFRESH_MS)
  }

  private stopRefreshing(): void {
    if (this.refresh) clearInterval(this.refresh)
    this.refresh = undefined
  }

  private send(channel: string, payload: unknown): void {
    if (!this.window.isDestroyed()) this.window.webContents.send(channel, payload)
  }
}

function bounds(rect: Rect): Electron.Rectangle {
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.w), height: Math.round(rect.h) }
}
