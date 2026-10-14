import { bounds, toDesk, type Rect, type View } from '@carrel/desk'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

/** The minimap's size on screen. */
const MAP = { w: 168, h: 112 }

/**
 * Bottom right of the desk: a small map of the whole desk with the visible
 * part outlined (click or drag on it to look elsewhere), and the zoom pill.
 */
export function DeskNav(props: {
  view: View
  screen: { w: number; h: number }
  sheets: readonly Rect[]
  onView: (view: View) => void
  onZoom: (direction: 1 | -1) => void
  onActualSize: () => void
  onFit: () => void
  onTidy: () => void
  onAddSheet: () => void
}) {
  const { view, screen, sheets } = props
  const visible = { ...toDesk(view, { x: 0, y: 0 }), w: screen.w / view.zoom, h: screen.h / view.zoom }
  const world = bounds([visible, ...sheets])!
  const ratio = Math.min(MAP.w / world.w, MAP.h / world.h)
  const onMap = (rect: Rect): CSSProperties => ({
    left: (rect.x - world.x) * ratio + (MAP.w - world.w * ratio) / 2,
    top: (rect.y - world.y) * ratio + (MAP.h - world.h * ratio) / 2,
    width: Math.max(2, rect.w * ratio),
    height: Math.max(2, rect.h * ratio),
  })

  // Centers the view on the desk point under the pointer.
  const lookAt = (event: ReactPointerEvent<HTMLElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left - (MAP.w - world.w * ratio) / 2) / ratio + world.x
    const y = (event.clientY - box.top - (MAP.h - world.h * ratio) / 2) / ratio + world.y
    props.onView({ zoom: view.zoom, x: screen.w / 2 - x * view.zoom, y: screen.h / 2 - y * view.zoom })
  }

  return (
    <div className="desk-nav">
      {sheets.length > 0 && (
        <div
          className="minimap"
          role="img"
          aria-label="Map of the desk"
          style={{ width: MAP.w, height: MAP.h }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            lookAt(event)
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1) lookAt(event)
          }}
        >
          {sheets.map((sheet, i) => (
            <span key={i} className="minimap-sheet" style={onMap(sheet)} />
          ))}
          <span className="minimap-view" style={onMap(visible)} />
        </div>
      )}
      <div className="desk-tools">
        <button type="button" aria-label="Zoom out" onClick={() => props.onZoom(-1)}>
          −
        </button>
        <button type="button" className="zoom-level position" title="Actual size" onClick={props.onActualSize}>
          {Math.round(view.zoom * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => props.onZoom(1)}>
          +
        </button>
        <button type="button" onClick={props.onFit}>
          Fit
        </button>
        <button type="button" onClick={props.onTidy} disabled={sheets.length < 2}>
          Tidy up
        </button>
        <button type="button" onClick={props.onAddSheet}>
          + Sheet
        </button>
      </div>
    </div>
  )
}
