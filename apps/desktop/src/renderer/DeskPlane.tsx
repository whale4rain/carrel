import { changed, footprint, handles, move, placeNew, raise, resize, snap, type Guide, type Handle } from '@carrel/desk'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Sheet } from '../shared/workspace-api.js'

const api = window.carrel.workspace

/** A new blank sheet's size at 100%. */
const BLANK = { w: 400, h: 300 }

// `before` is the desk as the gesture found it; `start` is where it began
// (a move first raises its sheets).
type Gesture =
  | { kind: 'move'; before: Sheet[]; start: Sheet[]; from: { x: number; y: number }; ids: Set<string>; moved: boolean }
  | { kind: 'resize'; before: Sheet[]; start: Sheet[]; from: { x: number; y: number }; id: string; handle: Handle }

/**
 * The grid-paper mat and its sheets. Sheets move by their label row and
 * resize by eight handles; every finished gesture is saved as one change.
 */
export function DeskPlane({ deskId, name }: { deskId: string; name: string }) {
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [guides, setGuides] = useState<Guide[]>([])
  const [gesture, setGesture] = useState<Gesture>()
  const [error, setError] = useState<string>()
  const mat = useRef<HTMLElement>(null)
  const latest = useRef(sheets)
  latest.current = sheets

  useEffect(() => {
    let current = true
    setLoaded(false)
    setSelected(new Set())
    void api.desk(deskId).then((desk) => {
      if (!current) return
      setSheets(desk.sheets)
      setLoaded(true)
    })
    return () => {
      current = false
    }
  }, [deskId])

  const save = useCallback(
    (next: Sheet[], kind: string, ids: string[]) => {
      setSheets(next)
      api.saveSheets(deskId, next, { kind, ids }).then(
        () => setError(undefined),
        (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
      )
    },
    [deskId],
  )

  const point = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = mat.current?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }

  const addSheet = (): void => {
    const spot = placeNew(sheets)
    const sheet: Sheet = { id: crypto.randomUUID(), itemId: null, ...spot, ...BLANK, scale: 1, z: Math.max(0, ...sheets.map((s) => s.z)) + 1 }
    save([...sheets, sheet], 'added', [sheet.id])
    setSelected(new Set([sheet.id]))
  }

  const startMove = (event: ReactPointerEvent, id: string): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    let ids: Set<string>
    if (event.shiftKey) {
      ids = new Set(selected)
      if (ids.has(id)) ids.delete(id)
      else ids.add(id)
      setSelected(ids)
      return
    }
    ids = selected.has(id) ? selected : new Set([id])
    setSelected(ids)
    const start = raise(sheets, ids)
    setSheets(start)
    setGesture({ kind: 'move', before: sheets, start, from: point(event), ids, moved: false })
  }

  const startResize = (event: ReactPointerEvent, id: string, handle: Handle): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    setGesture({ kind: 'resize', before: sheets, start: sheets, from: point(event), id, handle })
  }

  useEffect(() => {
    if (!gesture) return
    // The gesture's latest preview, kept here because the release can arrive
    // before React renders the last move.
    let preview = gesture.start
    const show = (next: Sheet[]): void => {
      preview = next
      setSheets(next)
    }
    const onMove = (event: PointerEvent): void => {
      const at = point(event)
      const dx = at.x - gesture.from.x
      const dy = at.y - gesture.from.y
      if (gesture.kind === 'move') {
        if (!gesture.moved && Math.hypot(dx, dy) < 3) return
        gesture.moved = true
        const moved = move(gesture.start, gesture.ids, dx, dy)
        // Snap the group by the sheet under the pointer's group bounds: the first selected sheet.
        const lead = moved.find((sheet) => gesture.ids.has(sheet.id))
        const others = moved.filter((sheet) => !gesture.ids.has(sheet.id)).map(footprint)
        const snapped = lead ? snap(footprint(lead), others) : { dx: 0, dy: 0, guides: [] }
        show(move(moved, gesture.ids, snapped.dx, snapped.dy))
        setGuides(snapped.guides)
      } else {
        show(gesture.start.map((sheet) => (sheet.id === gesture.id ? resize(sheet, gesture.handle, dx, dy) : sheet)))
      }
    }
    const onUp = (event: PointerEvent): void => {
      onMove(event)
      setGesture(undefined)
      setGuides([])
      const current = preview
      const touched = changed(gesture.before, current).map((sheet) => sheet.id)
      if (touched.length === 0) return
      // A click without a drag still raised the sheet, which is worth keeping.
      const kind = gesture.kind === 'resize' ? 'resized' : gesture.moved ? 'moved' : 'raised'
      save(current, kind, touched)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [gesture, save])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelected(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const single = selected.size === 1 ? sheets.find((sheet) => selected.has(sheet.id)) : undefined

  return (
    <main
      className="desk-mat"
      aria-label="Desk"
      ref={mat}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setSelected(new Set())
      }}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) addSheet()
      }}
    >
      {loaded && sheets.length === 0 && (
        <p className="desk-empty">
          <span className="desk-empty-title">{name} is empty.</span>
          Add a book, a video or a web page to start, or double-click for a blank sheet.
        </p>
      )}
      {sheets.map((sheet) => {
        const box = footprint(sheet)
        const isSelected = selected.has(sheet.id)
        const lifted = gesture?.kind === 'move' && gesture.moved && gesture.ids.has(sheet.id)
        return (
          <section
            key={sheet.id}
            className="sheet"
            data-selected={isSelected || undefined}
            data-lifted={lifted || undefined}
            aria-label="Blank sheet"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: sheet.z }}
          >
            <div className="sheet-paper" style={{ width: sheet.w, height: sheet.h, transform: `scale(${sheet.scale})` }}>
              <div className="sheet-label" onPointerDown={(event) => startMove(event, sheet.id)}>
                <span>Blank sheet</span>
                <span className="position">{Math.round(sheet.scale * 100)}%</span>
              </div>
            </div>
          </section>
        )
      })}
      {single &&
        (() => {
          const box = footprint(single)
          return (
            <div className="handles" style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: single.z }}>
              {handles.map((handle) => (
                <span key={handle} className={`handle handle-${handle}`} onPointerDown={(event) => startResize(event, single.id, handle)} />
              ))}
              {gesture?.kind === 'resize' && (
                <span className="size-label position">
                  {Math.round(single.w)} × {Math.round(single.h)}
                </span>
              )}
            </div>
          )
        })()}
      {guides.map((guide, i) => (
        <span
          key={i}
          className={`guide guide-${guide.axis}`}
          style={
            guide.axis === 'x'
              ? { left: guide.at, top: guide.from, height: guide.to - guide.from }
              : { top: guide.at, left: guide.from, width: guide.to - guide.from }
          }
        />
      ))}
      <div className="desk-tools">
        <button type="button" onClick={addSheet}>
          + Sheet
        </button>
      </div>
      {error && (
        <p className="desk-error" role="alert">
          Couldn't save: {error}
        </p>
      )}
    </main>
  )
}
