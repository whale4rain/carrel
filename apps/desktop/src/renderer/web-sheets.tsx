import { footprint, rectToScreen, type Rect, type View } from '@carrel/desk'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ItemView, Sheet } from '../shared/workspace-api.js'
import { asWebPage } from './video.js'

const api = window.carrel.workspace
const web = window.carrel.web

/** The sheet's label row, in desk units at 100%. */
const LABEL = 36
/** Things drawn over the desk that a live page must not cover. */
const OVERLAYS = '.desk-nav, .selection-bar, .add-menu, .desk-error, .that-tray'

/**
 * Web pages on the desk. Main draws the live page as a native view over its
 * sheet; this tells main where every sheet is, and keeps each page's last
 * snapshot to show while it isn't live.
 */
export function useWebSheets(props: {
  mat: RefObject<HTMLElement | null>
  sheets: readonly Sheet[]
  items: ReadonlyMap<string, ItemView>
  view: View
  active: string | undefined
  moving: boolean
}): { live: string | undefined; snapshots: ReadonlyMap<string, string> } {
  const { mat, sheets, items, view, active, moving } = props
  const [live, setLive] = useState<string>()
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, string>>(new Map())
  const sent = useRef('')

  const keep = (itemId: string, png: Uint8Array): void => {
    const url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))
    setSnapshots((known) => {
      const old = known.get(itemId)
      if (old) URL.revokeObjectURL(old)
      return new Map(known).set(itemId, url)
    })
  }

  useEffect(() => {
    const offLive = web.onLive((sheet) => setLive(sheet ?? undefined))
    const offSnapshot = web.onSnapshot((_sheet, itemId, png) => keep(itemId, png))
    return () => {
      offLive()
      offSnapshot()
      // Leaving the desk closes its pages.
      web.layout({ sheets: [], active: undefined, moving: false, desk: { x: 0, y: 0, w: 0, h: 0 }, overlays: [] })
    }
  }, [])

  // Snapshots saved last time, so a reopened desk shows its pages at once.
  const webItems = sheets.flatMap((sheet) => {
    const item = sheet.itemId === null ? undefined : items.get(sheet.itemId)
    return asWebPage(item) ? [item.id] : []
  })
  const asked = useRef(new Set<string>())
  useEffect(() => {
    for (const id of webItems) {
      if (asked.current.has(id)) continue
      asked.current.add(id)
      void api.snapshot(id).then((png) => {
        if (png) keep(id, png)
      })
    }
  })

  // Tell main where things are whenever anything moved.
  useEffect(() => {
    const element = mat.current
    if (!element) return
    const origin = element.getBoundingClientRect()
    const toWindow = (rect: Rect): Rect => ({ x: rect.x + origin.left, y: rect.y + origin.top, w: rect.w, h: rect.h })
    const layout = {
      sheets: sheets.map((sheet) => {
        const item = sheet.itemId === null ? undefined : items.get(sheet.itemId)
        const box = toWindow(rectToScreen(view, footprint(sheet)))
        const label = LABEL * sheet.scale * view.zoom
        return {
          id: sheet.id,
          web: asWebPage(item),
          box,
          page: { x: box.x, y: box.y + label, w: box.w, h: box.h - label },
          z: sheet.z,
          zoom: sheet.scale * view.zoom,
          ...(asWebPage(item) ? { itemId: item.id, url: item.url } : {}),
        }
      }),
      active,
      moving,
      desk: { x: origin.left, y: origin.top, w: origin.width, h: origin.height },
      overlays: [...element.querySelectorAll(OVERLAYS)].map((overlay) => {
        const r = overlay.getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      }),
    }
    const json = JSON.stringify(layout)
    if (json === sent.current) return
    sent.current = json
    web.layout(layout)
  })

  return { live, snapshots }
}

/** A web sheet's page area: its snapshot, or the live page drawn over it by main. */
export function WebPage({
  item,
  snapshot,
  live,
  waiting,
  onActivate,
}: {
  item: ItemView
  snapshot: string | undefined
  live: boolean
  /** Clicked into, but something keeps it from going live. */
  waiting: boolean
  onActivate: () => void
}) {
  return (
    <div className="web-page" data-live={live || undefined} onPointerDown={onActivate}>
      {waiting && <p className="web-page-hint">Bring the whole page into view, with nothing over it, to open it.</p>}
      {snapshot ? (
        <img src={snapshot} alt={`Snapshot of ${item.title}`} draggable={false} />
      ) : (
        <div className="source-face">
          <h3>{item.title}</h3>
          <p className="source-url">{item.url}</p>
          <p>Click to open the page.</p>
        </div>
      )}
    </div>
  )
}
