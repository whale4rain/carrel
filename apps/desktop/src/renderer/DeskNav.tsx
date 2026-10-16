import { bounds, toDesk, type Rect, type View } from '@carrel/desk'
import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { KitView } from '../shared/workspace-api.js'
import { shortcutLabel, withShortcut } from '../shared/shortcuts.js'
import { HandIcon, MapIcon } from './icons.js'
import { frame } from './platform.js'

/** The minimap's size on screen. */
const MAP = { w: 168, h: 112 }
/** Whether the map is shown is remembered on this computer, not per desk. */
const MAP_SHOWN = 'carrel.map-shown'

function mapShown(): boolean {
  try {
    return localStorage.getItem(MAP_SHOWN) === 'true'
  } catch {
    return false
  }
}

/**
 * Bottom right of the desk: the zoom pill, with the hand (drag the desk to
 * move around) and a small map of the whole desk with the visible part
 * outlined (click or drag on it to look elsewhere). The map is hidden until
 * asked for.
 */
export function DeskNav(props: {
  view: View
  screen: { w: number; h: number }
  sheets: readonly Rect[]
  onView: (view: View) => void
  /** The hand is on: dragging anywhere on the desk moves it. */
  hand: boolean
  onHand: () => void
  onZoom: (direction: 1 | -1) => void
  onActualSize: () => void
  onFit: () => void
  onTidy: () => void
  onAddSheet: () => void
  onAddNote: () => void
  onAddFiles: () => void
  onAddLink: (url: string) => void
  /** Lays a kit's sheet on the desk, adding the kit to the project first if it isn't yet. */
  onAddKit: (kit: string, sheet: string) => void
}) {
  const [adding, setAdding] = useState<'menu' | 'link' | 'kits'>()
  const [kits, setKits] = useState<KitView[]>()
  const [link, setLink] = useState('')
  const [showMap, setShowMap] = useState(mapShown)
  // Only a drag that starts on the map moves the view; a resize passing over it does not.
  const dragging = useRef(false)
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
      {showMap && sheets.length > 0 && (
        <div
          className="minimap"
          role="img"
          aria-label="Map of the desk"
          style={{ width: MAP.w, height: MAP.h }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            dragging.current = true
            lookAt(event)
          }}
          onPointerMove={(event) => {
            if (dragging.current) lookAt(event)
          }}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
        >
          {sheets.map((sheet, i) => (
            <span key={i} className="minimap-sheet" style={onMap(sheet)} />
          ))}
          <span className="minimap-view" style={onMap(visible)} />
        </div>
      )}
      <div className="desk-tools">
        <button type="button" className="desk-hand" aria-label="Hand" aria-pressed={props.hand} title={`Hand: drag the desk to move around (${shortcutLabel(frame, 'hand')}, or hold Space)`} onClick={props.onHand}>
          <HandIcon />
        </button>
        <button
          type="button"
          className="desk-map"
          aria-label="Map"
          aria-pressed={showMap}
          title="Map of the desk"
          onClick={() => {
            setShowMap(!showMap)
            try {
              localStorage.setItem(MAP_SHOWN, String(!showMap))
            } catch {
              // Not remembered; it still shows.
            }
          }}
        >
          <MapIcon />
        </button>
        <button type="button" aria-label="Zoom out" title={withShortcut(frame, 'Zoom out', 'zoom-out')} onClick={() => props.onZoom(-1)}>
          −
        </button>
        <button type="button" className="zoom-level position" title={withShortcut(frame, 'Actual size', 'actual-size')} onClick={props.onActualSize}>
          {Math.round(view.zoom * 100)}%
        </button>
        <button type="button" aria-label="Zoom in" title={withShortcut(frame, 'Zoom in', 'zoom-in')} onClick={() => props.onZoom(1)}>
          +
        </button>
        <button type="button" title={withShortcut(frame, 'Fit everything in view', 'fit')} onClick={props.onFit}>
          Fit
        </button>
        <button type="button" onClick={props.onTidy} disabled={sheets.length < 2}>
          Tidy up
        </button>
        <button type="button" aria-expanded={adding !== undefined} onClick={() => setAdding(adding ? undefined : 'menu')}>
          + Add
        </button>
      </div>
      {adding === 'menu' && (
        <div className="add-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAdding(undefined)
              props.onAddNote()
            }}
          >
            Note
            <small>A new note on this desk</small>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAdding(undefined)
              props.onAddFiles()
            }}
          >
            Book or paper…
            <small>PDF, EPUB, Word, PowerPoint, Markdown</small>
          </button>
          <button type="button" role="menuitem" onClick={() => setAdding('link')}>
            Web page or video link…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAdding('kits')
              window.carrel.workspace.kits().then(setKits, () => setKits([]))
            }}
          >
            Learning kit…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAdding(undefined)
              props.onAddSheet()
            }}
          >
            Blank sheet
          </button>
        </div>
      )}
      {adding === 'kits' && (
        <div
          className="add-menu add-kits"
          role="menu"
          aria-label="Learning kits"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setAdding(undefined)
          }}
        >
          {kits === undefined && <p className="add-note">Looking for kits…</p>}
          {kits?.length === 0 && <p className="add-note">No learning kits are installed.</p>}
          {kits?.map((kit) => (
            <div key={kit.name} className="add-kit" role="group" aria-label={kit.title}>
              <p className="add-kit-title">
                {kit.title}
                {kit.added && <small> · in this project</small>}
              </p>
              {kit.description && <p className="add-note">{kit.description}</p>}
              {kit.sheets.map((sheet) => (
                <button
                  key={sheet.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAdding(undefined)
                    props.onAddKit(kit.name, sheet.id)
                  }}
                >
                  {sheet.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {adding === 'link' && (
        <form
          className="add-menu add-link"
          onSubmit={(event) => {
            event.preventDefault()
            if (link.trim().length === 0) return
            props.onAddLink(link.trim())
            setLink('')
            setAdding(undefined)
          }}
        >
          <input
            autoFocus
            type="url"
            placeholder="Paste a link"
            aria-label="Link to a web page or video"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAdding(undefined)
            }}
          />
          <button type="submit">Add</button>
        </form>
      )}
    </div>
  )
}
