import { momentOf, regionOf } from '@carrel/core/selectors'
import { isDocumentFile } from '@carrel/core/document-files'
import {
  bounds,
  changed,
  emptyHistory,
  fitView,
  intersects,
  FOLDED_H,
  footprint,
  handles,
  inMarquee,
  makePile,
  move,
  PILE_LABEL,
  piles,
  placeNew,
  raise,
  record,
  rectFrom,
  rectToScreen,
  redo,
  remove,
  resize,
  SCALES,
  scaleTo,
  foldTo,
  snap,
  spread,
  tidy,
  toDesk,
  touched,
  undo,
  visibleRect,
  withPiles,
  showIn,
  zoomAt,
  zoomStep,
  type Guide,
  type Handle,
  type History,
  type Rect,
  type View,
} from '@carrel/desk'
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ItemView, Sheet, ThatRequest, ThatView, WebLoading } from '../shared/workspace-api.js'
import { DeskNav } from './DeskNav.js'
import { PdfView, type Focus } from './PdfView.js'
import { DocView } from './DocView.js'
import { NoteView } from './NoteView.js'
import { citesLine, kindLabel, linkIn, sheetFor, sourceLine } from './sources.js'
import { KitView } from './KitView.js'
import { pdfSelection } from './that.js'
import { DESK_COMMAND, frame } from './platform.js'
import { shortcutLabel, withShortcut } from '../shared/shortcuts.js'
import { TEXT_COMMANDS, type AgentAsk, type MenuEntry } from '../shared/menu.js'
import { SavedThat, ThatTray } from './ThatTray.js'
import { asWebPage, embedded } from './video.js'
import { seekVideo, VideoView, videoMoment } from './VideoView.js'
import { pageZoomStep, useWebSheets, WebPage } from './web-sheets.js'

const api = window.carrel.workspace

/** Sheets this far outside the screen (in screen pixels) stay mounted. */
const MOUNT_MARGIN = 400
/** The grid paper's square at 100%. */
const GRID = 24
/** Focus: the dark bar above, the shelf below, and the margin around the sheet, in screen pixels. */
const FOCUS_BAR = 44
const FOCUS_SHELF = 96
const FOCUS_MARGIN = 48
/** A focused sheet is no wider than this, so lines stay readable. */
const FOCUS_MAX_W = 1100
/** Sheets kept beside the focused one, at most. */
const FOCUS_BESIDE = 2
/** A shelf card being dragged up beside the focused sheet. */
const SHELF_DRAG = 'application/x-carrel-sheet'

// `before` is the desk as the gesture found it; `start` is where it began
// (a move first raises its sheets).
type Gesture =
  | { kind: 'move'; before: Sheet[]; start: Sheet[]; from: { x: number; y: number }; ids: Set<string>; moved: boolean }
  | { kind: 'resize'; before: Sheet[]; start: Sheet[]; from: { x: number; y: number }; id: string; handle: Handle }
  // A marquee from the bare mat; `base` is what stays selected (Shift keeps the selection).
  | { kind: 'marquee'; from: { x: number; y: number }; base: Set<string> }
  // Panning with Space held or the middle button; `from` is in screen pixels.
  | { kind: 'pan'; from: { x: number; y: number }; start: View }
  // A region for that., drawn with ⌥ (Alt) over a sheet.
  | { kind: 'region'; sheet: string; from: { x: number; y: number } }

/**
 * The grid-paper mat and its sheets. Sheets move by their label row and
 * resize by eight handles; every finished gesture is saved as one change and
 * is one step for undo (⌘Z / Ctrl+Z) and redo (⇧⌘Z / Ctrl+Shift+Z or Ctrl+Y).
 * Undo history lasts while the desk is open.
 *
 * The desk pans with two-finger scroll, Space-drag or the middle button, and
 * zooms with pinch, ⌘/Ctrl-scroll, ⌘+ and ⌘−; the view is saved with the desk.
 * Only sheets near the screen are mounted.
 */
/** Something to show on the desk: an item, and maybe a *that.* or a page in it. `nonce` lets it be asked again. */
export interface ShowRequest {
  itemId: string
  nonce: number
  /** A note: start writing in it. */
  write?: boolean
  that?: string
  page?: number
}

export function DeskPlane({
  deskId,
  name,
  items,
  onItemsAdded,
  show,
  onPointed,
  onContext,
  onAsk,
  onOpenLink,
}: {
  deskId: string
  name: string
  /** The project's sources and notes, by id. */
  items: ReadonlyMap<string, ItemView>
  onItemsAdded: (items: ItemView[]) => void
  /** An item asked for from outside the desk (the sidebar, search): brought into view, or put on the desk. */
  show?: ShowRequest | undefined
  /** You made a *that.*: the agent's composer points at it. */
  onPointed?: (that: ThatView) => void
  /** What is on this desk and selected, for the agent. */
  onContext?: (context: { name: string; items: string[]; selected: string[] }) => void
  /** Something right-clicked to ask the agent about, with the *that.* made of it. */
  onAsk?: (ask: AgentAsk, that?: ThatView) => void
  /** A [[link]] in a note was clicked. */
  onOpenLink?: (target: string) => void
}) {
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [guides, setGuides] = useState<Guide[]>([])
  const [gesture, setGesture] = useState<Gesture>()
  const [marquee, setMarquee] = useState<Rect>()
  // A region drawn over a sheet, in desk units, waiting for that. (⌘ .).
  const [region, setRegion] = useState<{ sheet: string; rect: Rect }>()
  const [capturing, setCapturing] = useState(false)
  const [scaling, setScaling] = useState(false)
  const [error, setError] = useState<string>()
  // The project's *that.*s; those on this desk's sources are chips on the tray.
  const [thats, setThats] = useState<readonly ThatView[]>([])
  useEffect(() => {
    let current = true
    void api.thats().then((list) => {
      if (current) setThats(list)
    })
    return () => {
      current = false
    }
  }, [])
  const keepThat = useCallback((that: ThatView): void => setThats((known) => [...known.filter((other) => other.id !== that.id), that]), [])
  const pointed = useRef(onPointed)
  pointed.current = onPointed
  const addToTray = useCallback(
    (that: ThatView): void => {
      keepThat(that)
      pointed.current?.(that)
    },
    [keepThat],
  )
  useEffect(() => window.carrel.web.onThat(addToTray), [addToTray])
  // The agent's *that.*s open like yours, but you weren't the one pointing.
  useEffect(() => window.carrel.agent.onThat(keepThat), [keepThat])
  // Chips taken off the tray this session: that.s still in use stay in the project.
  const [offTray, setOffTray] = useState<ReadonlySet<string>>(new Set())
  // The that. being opened, and those whose words are gone from their source.
  const [focus, setFocus] = useState<Focus & { sheet: string }>()
  const [lost, setLost] = useState<ReadonlySet<string>>(new Set())
  const [savedCopy, setSavedCopy] = useState<ThatView>()
  const found = useCallback(
    (id: string, here: boolean): void => {
      setLost((known) => {
        if (known.has(id) === !here) return known
        const next = new Set(known)
        if (here) next.delete(id)
        else next.add(id)
        return next
      })
      if (!here) setSavedCopy(thats.find((that) => that.id === id))
    },
    [thats],
  )
  useEffect(() => window.carrel.web.onFound(found), [found])
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 })
  // The web sheet clicked into; it goes live when nothing covers it.
  const [active, setActive] = useState<string>()
  // Web pages loading, or that failed to load, by sheet.
  const [loading, setLoading] = useState<ReadonlyMap<string, WebLoading>>(new Map())
  useEffect(
    () =>
      window.carrel.web.onLoading((sheet, state) =>
        setLoading((known) => (state.loading || state.error ? new Map(known).set(sheet, state) : new Map([...known].filter(([id]) => id !== sheet)))),
      ),
    [],
  )
  // Where each source sheet is reading (a page, a time), for its label.
  const [positions, setPositions] = useState<ReadonlyMap<string, string>>(new Map())
  const reportPosition = useCallback((sheet: string, at: string): void => {
    setPositions((known) => (known.get(sheet) === at ? known : new Map(known).set(sheet, at)))
  }, [])
  const [screen, setScreen] = useState({ w: 0, h: 0 })
  const screenRef = useRef(screen)
  screenRef.current = screen
  const mat = useRef<HTMLElement>(null)
  const viewRef = useRef(view)
  // The view as last loaded or saved, so loading one doesn't save it back.
  const savedView = useRef<View>(view)
  const space = useRef(false)
  // The hand: dragging anywhere on the desk moves it (H toggles; holding Space borrows it).
  const [hand, setHand] = useState(false)
  // The sheet filling the desk in Focus; the rest wait on the shelf. Nothing about it is saved.
  const [focused, setFocused] = useState<string>()
  const focusedRef = useRef(focused)
  focusedRef.current = focused
  // In Focus the desk is drawn at 100% with only the focused sheet, laid over the
  // middle of the screen; the saved layout and view are untouched.
  const inFocus = focused === undefined ? undefined : sheets.find((sheet) => sheet.id === focused)
  // Sheets pinned beside the focused one (a note to write in, a second source); they stay pinned for next time.
  const [beside, setBeside] = useState<string[]>([])
  const besideShown = inFocus ? beside.flatMap((id) => sheets.filter((sheet) => sheet.id === id && id !== inFocus.id)) : []
  const shownView: View = inFocus ? { x: 0, y: 0, zoom: 1 } : view
  const focusLaidOut = inFocus ? focusLayout([inFocus, ...besideShown], screen) : []
  const focusPlaces = useRef(new Map<string, Sheet>())
  focusPlaces.current = new Map(focusLaidOut.map((sheet) => [sheet.id, sheet]))
  // Pointer math follows what is drawn.
  viewRef.current = shownView
  // A focused sheet taken off the desk (by another window, say) ends Focus.
  useEffect(() => {
    if (focused && !inFocus && loaded) setFocused(undefined)
  }, [focused, inFocus, loaded])
  const latest = useRef(sheets)
  latest.current = sheets
  const history = useRef<History<Sheet>>(emptyHistory())

  useEffect(() => {
    let current = true
    setLoaded(false)
    setSelected(new Set())
    setFocused(undefined)
    setBeside([])
    history.current = emptyHistory()
    void api.desk(deskId).then((desk) => {
      if (!current) return
      setSheets(desk.sheets)
      savedView.current = desk.viewport
      setView(desk.viewport)
      setLoaded(true)
    })
    return () => {
      current = false
    }
  }, [deskId])

  // Writes the desk and logs one event. `before` makes it an undoable step;
  // undo and redo themselves pass none.
  const save = useCallback(
    (next: Sheet[], kind: string, ids: string[], before?: Sheet[]) => {
      if (before) history.current = record(history.current, { kind, before, after: next })
      setSheets(next)
      api.saveSheets(deskId, next, { kind, ids }).then(
        () => setError(undefined),
        (reason: unknown) => setError(`Couldn't save: ${message(reason)}`),
      )
    },
    [deskId],
  )

  // Remember the view a moment after it stops changing.
  useEffect(() => {
    if (!loaded) return
    const saved = savedView.current
    if (saved.x === view.x && saved.y === view.y && saved.zoom === view.zoom) return
    const timer = setTimeout(() => {
      savedView.current = view
      api.saveViewport(deskId, view).catch((reason: unknown) => setError(`Couldn't save: ${message(reason)}`))
    }, 400)
    return () => clearTimeout(timer)
  }, [deskId, loaded, view])

  useEffect(() => {
    const element = mat.current
    if (!element) return
    const observer = new ResizeObserver(() => setScreen({ w: element.clientWidth, h: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /** Where the pointer is on the screen, relative to the mat. */
  const onScreen = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = mat.current?.getBoundingClientRect()
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) }
  }

  /** Where the pointer is on the desk. */
  const point = (event: { clientX: number; clientY: number }): { x: number; y: number } => toDesk(viewRef.current, onScreen(event))

  const zoomBy = useCallback(
    (direction: 1 | -1): void => {
      setView((current) => zoomAt(current, { x: screen.w / 2, y: screen.h / 2 }, zoomStep(current.zoom, direction)))
    },
    [screen],
  )
  const actualSize = useCallback((): void => {
    setView((current) => zoomAt(current, { x: screen.w / 2, y: screen.h / 2 }, 1))
  }, [screen])
  const fit = useCallback((): void => {
    const all = bounds(latest.current.map(footprint))
    if (all) setView(fitView(all, screen.w, screen.h))
  }, [screen])

  // Scroll pans; pinch (which arrives as Ctrl-scroll) and ⌘/Ctrl-scroll zoom around the pointer.
  useEffect(() => {
    const element = mat.current
    if (!element) return
    const onWheel = (event: WheelEvent): void => {
      // A source that scrolls (a PDF) takes plain scrolling over it.
      const target = event.target as HTMLElement | null
      if (!event.ctrlKey && !event.metaKey && target?.closest('[data-scrolls]')) return
      event.preventDefault()
      // Focus holds the desk still.
      if (focusedRef.current) return
      const at = onScreen(event)
      if (event.ctrlKey || event.metaKey) {
        setView((current) => zoomAt(current, at, current.zoom * Math.exp(-event.deltaY * 0.01)))
      } else {
        setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  // New sheets: a blank one, or one per added source. They land near `at`
  // (desk units), or near the top-left of the screen.
  const addSheets = (added: Array<ItemView | null>, at?: { x: number; y: number }): void => {
    const current = latest.current
    const shown = visibleRect(view, screen.w, screen.h)
    const origin = at ?? { x: Math.round(shown.x + 48 / view.zoom), y: Math.round(shown.y + 48 / view.zoom) }
    let next = current
    for (const item of added) {
      const size = sheetFor(item)
      const spot = placeNew(next, origin)
      const sheet: Sheet = { id: crypto.randomUUID(), itemId: item?.id ?? null, ...spot, ...size, z: Math.max(0, ...next.map((s) => s.z)) + 1 }
      next = [...next, sheet]
    }
    const ids = next.slice(current.length).map((sheet) => sheet.id)
    if (ids.length === 0) return
    setFocused(undefined)
    save(next, 'added', ids, current)
    setSelected(new Set(ids))
  }
  const addSheet = (): void => addSheets([null])

  // Sources come into the project first, then onto this desk.
  const addSources = (adding: Promise<ItemView[]>, at?: { x: number; y: number }): void => {
    adding.then(
      (added) => {
        if (added.length === 0) return
        onItemsAdded(added)
        addSheets(added, at)
        setError(undefined)
      },
      (reason: unknown) => setError(message(reason)),
    )
  }
  const addFiles = (): void => addSources(api.chooseFiles().then((paths) => (paths.length > 0 ? api.addFiles(paths) : [])))
  const addLink = (url: string, at?: { x: number; y: number }): void => addSources(api.addLink(url).then((item) => [item]), at)
  // A new note laid on this desk, ready to write in.
  const addNote = (): void => {
    api.createNote().then(
      (note) => {
        onItemsAdded([note])
        showItem(note, true)
        setError(undefined)
      },
      (reason: unknown) => setError(message(reason)),
    )
  }
  // A kit's sheet: the kit joins the project first; a sheet already on the desk comes forward.
  const addKit = (kit: string, sheetId: string, allow: boolean): void => {
    api.addKit(kit, allow).then(
      (sheets) => {
        onItemsAdded(sheets)
        const chosen = sheets.find((sheet) => sheet.kit?.sheet === sheetId)
        if (chosen) showItem(chosen, false)
        setError(undefined)
      },
      (reason: unknown) => setError(message(reason)),
    )
  }

  // A link pasted anywhere but a field becomes a source.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const url = linkIn(event.clipboardData?.getData('text/plain') ?? '')
      if (!url) return
      event.preventDefault()
      addLink(url)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const startMove = (event: ReactPointerEvent, id: string): void => {
    if (event.button !== 0 || focused) return
    if (active !== id) setActive(undefined)
    event.stopPropagation()
    // A sheet in a pile stands for the whole pile.
    const group = withPiles(sheets, [id])
    let ids: Set<string>
    if (event.shiftKey) {
      ids = new Set(selected)
      const dropping = ids.has(id)
      for (const one of group) {
        if (dropping) ids.delete(one)
        else ids.add(one)
      }
      setSelected(ids)
      return
    }
    ids = selected.has(id) ? selected : group
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
    let preview = gesture.kind === 'move' || gesture.kind === 'resize' ? gesture.start : []
    const show = (next: Sheet[]): void => {
      preview = next
      setSheets(next)
    }
    const onMove = (event: PointerEvent): void => {
      if (gesture.kind === 'pan') {
        const at = onScreen(event)
        setView({ ...gesture.start, x: gesture.start.x + at.x - gesture.from.x, y: gesture.start.y + at.y - gesture.from.y })
        return
      }
      const at = point(event)
      const dx = at.x - gesture.from.x
      const dy = at.y - gesture.from.y
      if (gesture.kind === 'region') {
        const found = latest.current.find((candidate) => candidate.id === gesture.sheet)
        const sheet = (found && focusPlaces.current.get(found.id)) ?? found
        if (sheet) setRegion({ sheet: sheet.id, rect: clip(rectFrom(gesture.from, at), footprint(sheet)) })
      } else if (gesture.kind === 'marquee') {
        if (Math.hypot(dx, dy) < 3) return
        const rect = rectFrom(gesture.from, at)
        setMarquee(rect)
        setSelected(new Set([...gesture.base, ...withPiles(latest.current, inMarquee(latest.current, rect))]))
      } else if (gesture.kind === 'move') {
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
      setMarquee(undefined)
      if (gesture.kind === 'region') setRegion((drawn) => (drawn && drawn.rect.w >= 8 && drawn.rect.h >= 8 ? drawn : undefined))
      if (gesture.kind === 'marquee' || gesture.kind === 'pan' || gesture.kind === 'region') return
      const current = preview
      const ids = changed(gesture.before, current).map((sheet) => sheet.id)
      if (ids.length === 0) return
      // A click without a drag still raised the sheet, which is worth keeping.
      const kind = gesture.kind === 'resize' ? 'resized' : gesture.moved ? 'moved' : 'raised'
      save(current, kind, ids, gesture.before)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [gesture, save])

  const travel = useCallback(
    (direction: 'undo' | 'redo'): void => {
      const result = direction === 'undo' ? undo(history.current) : redo(history.current)
      if (!result) return
      history.current = result.history
      const next = [...result.sheets]
      const ids = touched(latest.current, next)
      save(next, direction === 'undo' ? 'undone' : 'redone', ids)
      const present = new Set(next.map((sheet) => sheet.id))
      setSelected(new Set(ids.filter((id) => present.has(id))))
    },
    [save],
  )

  const pileSelected = (): void => {
    const current = latest.current
    const next = makePile(current, selected, crypto.randomUUID())
    save(
      next,
      'piled',
      changed(current, next).map((sheet) => sheet.id),
      current,
    )
  }

  const spreadSelected = (pile: string): void => {
    const current = latest.current
    const next = spread(current, pile)
    save(
      next,
      'spread',
      changed(current, next).map((sheet) => sheet.id),
      current,
    )
  }

  // Rows as wide as the screen shows; one undoable step.
  const tidyUp = (): void => {
    const current = latest.current
    const next = tidy(current, Math.max(800, (screen.w - 96) / view.zoom))
    const ids = changed(current, next).map((sheet) => sheet.id)
    if (ids.length > 0) save(next, 'tidied', ids, current)
  }

  const scaleSelected = (scale: number): void => {
    const current = latest.current
    const next = scaleTo(current, selected, scale)
    const ids = changed(current, next).map((sheet) => sheet.id)
    if (ids.length > 0) save(next, 'scaled', ids, current)
  }

  // Fold the selection down to label rows, or open it again if it is all folded.
  const foldSelected = (): void => {
    const current = latest.current
    const folding = !current.filter((sheet) => selected.has(sheet.id)).every((sheet) => sheet.folded)
    const next = foldTo(current, selected, folding)
    const ids = changed(current, next).map((sheet) => sheet.id)
    if (ids.length > 0) save(next, folding ? 'folded' : 'unfolded', ids, current)
  }
  const foldOne = (id: string): void => {
    const current = latest.current
    const folding = !current.find((sheet) => sheet.id === id)?.folded
    save(foldTo(current, new Set([id]), folding), folding ? 'folded' : 'unfolded', [id], current)
  }

  // Focus: one sheet fills the desk. A web sheet goes live in it.
  const enterFocus = (id: string): void => {
    const sheet = latest.current.find((candidate) => candidate.id === id)
    if (!sheet) return
    // A sheet beside the focused one swaps places with it.
    const was = focusedRef.current
    if (was && was !== id) setBeside((now) => now.map((other) => (other === id ? was : other)))
    focusedRef.current = id
    setFocused(id)
    setSelected(new Set([id]))
    setScaling(false)
    const item = sheet.itemId === null ? undefined : items.get(sheet.itemId)
    setActive(asWebPage(item) ? id : undefined)
  }
  // Keep a sheet beside the focused one; the oldest goes back to the shelf when there's no room.
  const pinBeside = (id: string): void => {
    if (id === focusedRef.current) return
    setBeside((now) => [...now.filter((other) => other !== id), id].slice(-FOCUS_BESIDE))
  }
  const unpin = (id: string): void => setBeside((now) => now.filter((other) => other !== id))
  const leaveFocus = (): void => {
    focusedRef.current = undefined
    setFocused(undefined)
    setActive(undefined)
  }

  // A web page's or a PDF's own zoom inside its sheet: a step in or out, 100%, or (a web page) as wide as the sheet.
  const zoomPage = useCallback(
    async (id: string, how: 1 | -1 | 'actual' | 'fit'): Promise<void> => {
      const sheet = latest.current.find((candidate) => candidate.id === id)
      if (!sheet) return
      const now = sheet.pageZoom ?? 1
      let next: number
      if (how === 'actual') next = 1
      else if (how === 'fit') {
        const shrink = await window.carrel.web.fitWidth(id)
        next = shrink < 0.99 ? Math.max(0.25, Math.round(now * shrink * 100) / 100) : 1
      } else next = pageZoomStep(now, how)
      const current = latest.current
      const updated = current.map((other) => {
        if (other.id !== id) return other
        const zoomed: Sheet = { ...other, pageZoom: next }
        if (next === 1) delete zoomed.pageZoom
        return zoomed
      })
      const ids = changed(current, updated).map((other) => other.id)
      if (ids.length > 0) save(updated, 'zoomed', ids, current)
    },
    [save],
  )

  const removeSelected = useCallback((): void => {
    const current = latest.current
    const next = remove(current, selected)
    if (next.length === current.length) return
    save(next, 'removed', touched(current, next), current)
    setSelected(new Set())
  }, [save, selected])

  // ⌘. points at what is selected: text in a PDF, or the moment a selected video is at.
  const pointAt = useCallback(async (): Promise<ThatView | undefined> => {
    const itemOf = (id: string): string | undefined => latest.current.find((sheet) => sheet.id === id)?.itemId ?? undefined
    let request: ThatRequest | undefined
    const text = pdfSelection(window.getSelection())
    const textItem = text && itemOf(text.sheet)
    if (text && textItem) request = { itemId: textItem, ...text.request }
    else if (region) request = await regionRequest(region)
    else {
      const [only] = selected.size === 1 ? [...selected] : []
      const item = only === undefined ? undefined : items.get(itemOf(only) ?? '')
      const seconds = only === undefined ? undefined : videoMoment(only)
      const player = only === undefined ? undefined : mat.current?.querySelector(`.sheet[data-sheet="${only}"] .video-view`)
      if (item && embedded(item) && seconds !== undefined && player) {
        const box = player.getBoundingClientRect()
        const image = await window.carrel.web.frame({ x: box.left, y: box.top, w: box.width, h: box.height }).catch(() => undefined)
        request = { itemId: item.id, seconds, ...(image ? { image } : {}) }
      }
    }
    if (!request) {
      setError(`Select some text, a playing video, or ${frame === 'mac' ? '⌥' : 'Alt+'}drag a region, then press that. (${shortcutLabel(frame, 'that')}) to point at it.`)
      return undefined
    }
    try {
      const that = await api.makeThat(request)
      addToTray(that)
      setRegion(undefined)
      setError(undefined)
      return that
    } catch (reason) {
      setError(message(reason))
      return undefined
    }
  }, [addToTray, items, region, selected])

  // A region becomes a box in percent of the PDF page under it, or of the
  // sheet's source, with a picture of it taken without the dashed outline.
  const regionRequest = async (drawn: { sheet: string; rect: Rect }): Promise<ThatRequest | undefined> => {
    const sheet = latest.current.find((candidate) => candidate.id === drawn.sheet)
    const element = mat.current?.querySelector(`.sheet[data-sheet="${drawn.sheet}"]`)
    const origin = mat.current?.getBoundingClientRect()
    if (!sheet?.itemId || !element || !origin) return undefined
    const onScreen = rectToScreen(viewRef.current, drawn.rect)
    const box = new DOMRect(onScreen.x + origin.left, onScreen.y + origin.top, onScreen.w, onScreen.h)
    setCapturing(true)
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const image = await window.carrel.web.frame({ x: box.x, y: box.y, w: box.width, h: box.height }).catch(() => undefined)
    setCapturing(false)
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const page = [...element.querySelectorAll<HTMLElement>('.pdf-page, .doc-section')].find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      return middle.x >= rect.left && middle.x <= rect.right && middle.y >= rect.top && middle.y <= rect.bottom
    })
    const source = page ?? element.querySelector('.sheet-paper > :last-child') ?? element
    const seconds = videoMoment(drawn.sheet)
    return {
      itemId: sheet.itemId,
      region: percentOf(box, source.getBoundingClientRect()),
      ...(page ? { page: Number(page.dataset.page) } : {}),
      ...(seconds !== undefined ? { seconds } : {}),
      ...(image ? { image } : {}),
    }
  }

  // A chip brings its sheet into the middle of the view, selected, and opens
  // the spot: a PDF scrolls to the words, a video seeks, a web page goes live
  // and scrolls. If the words are gone, the saved copy shows instead.
  // A sheet to the middle of the view and on top, so nothing covers it. It sits above the
  // controls at the bottom, so a web page there can go live, zoomed out only if it must be.
  const bringForward = (sheet: Sheet): void => {
    // In Focus, the sheet asked for takes the desk.
    if (focusedRef.current) {
      enterFocus(sheet.id)
      return
    }
    const box = footprint(sheet)
    const origin = mat.current?.getBoundingClientRect()
    const below = [...(mat.current?.querySelectorAll('.desk-nav, .that-tray') ?? [])].map((element) => element.getBoundingClientRect().top - (origin?.top ?? 0))
    const clear = Math.min(screen.h, ...below) - 8
    setView((now) => showIn(now, box, { x: 0, y: 0, w: screen.w, h: clear }))
    setSelected(new Set([sheet.id]))
    const top = Math.max(...latest.current.map((other) => other.z))
    if (sheet.z < top) {
      save(
        latest.current.map((other) => (other.id === sheet.id ? { ...other, z: top + 1 } : other)),
        'raised',
        [sheet.id],
        latest.current,
      )
    }
  }

  // Tell the agent what is on the desk and what is selected.
  const deskItems = sheets.flatMap((sheet) => (sheet.itemId === null ? [] : [sheet.itemId]))
  const selectedItems = sheets.flatMap((sheet) => (selected.has(sheet.id) && sheet.itemId !== null ? [sheet.itemId] : []))
  const contextKey = `${name}|${deskItems.join()}|${selectedItems.join()}`
  useEffect(() => {
    onContext?.({ name, items: deskItems, selected: selectedItems })
    // The key holds everything the context is made of.
  }, [contextKey])

  // The sidebar or search asks for an item: bring its sheet forward, or lay it on the desk in the
  // middle of the view. A *that.* or a page in it is opened once its sheet is there.
  const [writing, setWriting] = useState<string>()
  const handled = useRef<number | undefined>(undefined)
  const placed = useRef<number | undefined>(undefined)
  const [goTo, setGoTo] = useState<{ sheet: string; page: number; nonce: number }>()
  useEffect(() => {
    if (!show || !loaded || screen.w === 0 || handled.current === show.nonce) return
    const item = items.get(show.itemId)
    if (!item) return
    const sheet = latest.current.find((candidate) => candidate.itemId === item.id)
    const that = show.that === undefined ? undefined : thats.find((known) => known.id === show.that)
    if (sheet && that) openThat(that)
    else if (placed.current !== show.nonce) {
      placed.current = show.nonce
      showItem(item, show.write === true)
    }
    // A sheet just laid down comes back here on the next render.
    if (!sheet && (that || show.page !== undefined)) return
    handled.current = show.nonce
    if (sheet && show.page !== undefined) setGoTo({ sheet: sheet.id, page: show.page, nonce: show.nonce })
  })
  function showItem(item: ItemView, write: boolean): void {
    const sheet = latest.current.find((candidate) => candidate.itemId === item.id)
    if (sheet) bringForward(sheet)
    else {
      const size = sheetFor(item)
      const middle = toDesk(view, { x: screen.w / 2, y: screen.h / 2 })
      addSheets([item], { x: Math.round(middle.x - (size.w * size.scale) / 2), y: Math.round(middle.y - (size.h * size.scale) / 2) })
    }
    if (write) setWriting(item.id)
  }
  // The project's notes, which [[ offers in a note.
  const notesList = [...items.values()].filter((item) => item.kind === 'note')
  // The notes that cite each source, and the source whose list is open.
  const citedBy = new Map<string, ItemView[]>()
  for (const note of items.values()) for (const source of note.cites ?? []) citedBy.set(source, [...(citedBy.get(source) ?? []), note])
  const [backlinks, setBacklinks] = useState<string>()

  const openThat = (that: ThatView): void => {
    setSavedCopy(undefined)
    const sheet = latest.current.find((candidate) => candidate.itemId === that.itemId)
    const item = items.get(that.itemId)
    if (!sheet || !item) {
      setSavedCopy(that)
      return
    }
    bringForward(sheet)
    const moment = momentOf(that.selectors)
    if (item.file) setFocus({ sheet: sheet.id, that, nonce: Date.now() })
    else if (embedded(item) && moment !== undefined) seekVideo(sheet.id, moment)
    // A region on a web page can't be found again in a page that scrolls; its picture is what it showed.
    else if (regionOf(that.selectors)) setSavedCopy(that)
    else if (asWebPage(item)) {
      setActive(sheet.id)
      window.carrel.web.showThat(sheet.id, that.id)
    }
  }
  const thatsOf = (itemId: string): ThatView[] => thats.filter((that) => that.itemId === itemId)
  const onDesk = new Set(sheets.flatMap((sheet) => (sheet.itemId === null ? [] : [sheet.itemId])))
  // The tray shows today's that.s; older ones stay in their sources and notes.
  const today = new Date().toDateString()
  const tray = thats.filter((that) => onDesk.has(that.itemId) && !offTray.has(that.id) && new Date(that.createdAt).toDateString() === today)
  const removeThat = (that: ThatView): void => {
    setOffTray((known) => new Set(known).add(that.id))
    void api.removeThat(that.id).then(
      (removed) => {
        if (removed) setThats((known) => known.filter((other) => other.id !== that.id))
      },
      () => undefined,
    )
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Typing in a field keeps its own undo and Backspace.
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if (gesture) return
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (event.key === ' ') space.current = true
      // Read through the ref: a key pressed right after Esc can beat this handler's renewal.
      const focused = focusedRef.current
      if (focused) {
        // Focus keeps the desk as it is: only Esc, that. and swapping sheets.
        const page = zoomable(focused)
        if (event.key === 'Escape') leaveFocus()
        else if (mod && event.key === '.') void pointAt()
        else if (page && mod && (event.key === '=' || event.key === '+')) void zoomPage(focused, 1)
        else if (page && mod && event.key === '-') void zoomPage(focused, -1)
        else if (page && mod && event.key === '0') void zoomPage(focused, 'actual')
        else return
        event.preventDefault()
        return
      }
      if (!mod && !event.altKey && key === 'h') setHand((on) => !on)
      else if (mod && event.key === 'Enter' && selected.size === 1) enterFocus([...selected][0]!)
      else if (event.key === 'Escape') {
        setSelected(new Set())
        setActive(undefined)
        setRegion(undefined)
      }
      else if (mod && (event.key === '=' || event.key === '+')) zoomBy(1)
      else if (mod && event.key === '-') zoomBy(-1)
      else if (mod && event.key === '0') actualSize()
      else if (mod && event.key === '1') fit()
      else if (mod && key === 'z') travel(event.shiftKey ? 'redo' : 'undo')
      else if (event.ctrlKey && !event.metaKey && key === 'y') travel('redo')
      else if (mod && event.key === '.') void pointAt()
      else if (mod && key === 'a') setSelected(new Set(latest.current.map((sheet) => sheet.id)))
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size > 0) removeSelected()
      else return
      event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === ' ') space.current = false
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  })

  // The menu bar's desk commands do what their keys do.
  useEffect(() => {
    const onCommand = (event: Event): void => {
      const id = (event as CustomEvent<string>).detail
      const focused = focusedRef.current
      if (focused) {
        const page = zoomable(focused)
        if (id === 'leave') leaveFocus()
        else if (id === 'that') void pointAt()
        else if (page && id === 'zoom-in') void zoomPage(focused, 1)
        else if (page && id === 'zoom-out') void zoomPage(focused, -1)
        else if (page && id === 'actual-size') void zoomPage(focused, 'actual')
        return
      }
      if (id === 'hand') setHand((on) => !on)
      else if (id === 'focus' && selected.size === 1) enterFocus([...selected][0]!)
      else if (id === 'zoom-in') zoomBy(1)
      else if (id === 'zoom-out') zoomBy(-1)
      else if (id === 'actual-size') actualSize()
      else if (id === 'fit') fit()
      else if (id === 'that') void pointAt()
      else if (id === 'select-all') setSelected(new Set(latest.current.map((sheet) => sheet.id)))
    }
    window.addEventListener(DESK_COMMAND, onCommand)
    return () => window.removeEventListener(DESK_COMMAND, onCommand)
  })

  // Scale choices close when the selection changes.
  useEffect(() => setScaling(false), [selected])

  // ⌘+, ⌘− and ⌘0 pressed inside a live page zoom that page.
  const liveRef = useRef<string | undefined>(undefined)
  useEffect(
    () =>
      window.carrel.web.onShortcut((key) => {
        const id = liveRef.current
        if (!id) return
        if (key === '=') void zoomPage(id, 1)
        else if (key === '-') void zoomPage(id, -1)
        else if (key === '0') void zoomPage(id, 'actual')
      }),
    [zoomPage],
  )
  /** Whether the sheet shows something with its own zoom: a web page, or a book or paper. */
  function zoomable(id: string): boolean {
    const itemId = latest.current.find((sheet) => sheet.id === id)?.itemId
    const item = itemId == null ? undefined : items.get(itemId)
    return item?.file !== undefined || asWebPage(item) !== undefined
  }

  const chosen = sheets.filter((sheet) => selected.has(sheet.id))
  const stacks = piles(sheets)
  // The selection is exactly one pile, or holds part of one.
  const chosenPiles = new Set(chosen.map((sheet) => sheet.pile))
  const onePile = chosenPiles.size === 1 ? [...chosenPiles][0] : undefined
  const hasPile = chosen.some((sheet) => sheet.pile !== undefined)
  const chosenBox = gesture || focused ? undefined : bounds(chosen.map(footprint))
  const around = chosenBox && rectToScreen(view, chosenBox)
  // Mount only sheets near the screen, plus any being worked on.
  const near = visibleRect(view, screen.w + MOUNT_MARGIN * 2, screen.h + MOUNT_MARGIN * 2)
  const reach = { ...near, x: near.x - MOUNT_MARGIN / view.zoom, y: near.y - MOUNT_MARGIN / view.zoom }
  const nearby = screen.w === 0 ? sheets : sheets.filter((sheet) => selected.has(sheet.id) || intersects(footprint(sheet), reach))
  const mounted: Sheet[] = inFocus ? focusLaidOut : nearby
  const { live, snapshots } = useWebSheets({ mat, sheets: mounted, items, view: shownView, active, moving: gesture !== undefined && gesture.kind !== 'marquee' })
  liveRef.current = live
  const single = !inFocus && selected.size === 1 ? sheets.find((sheet) => selected.has(sheet.id)) : undefined
  const shelf = inFocus ? sheets.filter((sheet) => !focusPlaces.current.has(sheet.id)).sort((a, b) => a.y - b.y || a.x - b.x) : []

  // Right-click: point at selected words or ask the agent about them; in a note,
  // ask the agent to rewrite them; Cut, Copy and Paste wherever you write.
  const contextMenu = async (event: ReactMouseEvent): Promise<void> => {
    const target = event.target as HTMLElement
    const selection = window.getSelection()
    const words = selection && !selection.isCollapsed ? selection.toString().trim() : ''
    const editable = target.closest('input, textarea, [contenteditable="true"]')
    const sheet = latest.current.find((candidate) => candidate.id === target.closest<HTMLElement>('.sheet')?.dataset.sheet)
    const item = sheet?.itemId ? items.get(sheet.itemId) : undefined
    const inPdf = words !== '' && pdfSelection(selection) !== undefined
    const inNote = words !== '' && item?.kind === 'note' && editable !== null && editable.contains(selection?.anchorNode ?? null)
    const line: MenuEntry = { separator: true }
    let entries: MenuEntry[]
    if (inPdf) entries = [...TEXT_COMMANDS, line, { role: 'copy' }]
    else if (inNote) entries = [{ id: 'ask', label: 'Ask the agent about this…' }, { id: 'rewrite', label: 'Rewrite with the agent…' }, line, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }]
    else if (editable) entries = [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, line, { role: 'selectAll' }]
    else if (words) entries = [{ role: 'copy' }]
    else return
    event.preventDefault()
    const picked = await window.carrel.menu(entries)
    if (inPdf && picked === 'that') void pointAt()
    else if (inPdf && (picked === 'ask' || picked === 'explain')) {
      const that = await pointAt()
      if (that) onAsk?.({ kind: picked }, that)
    } else if (inNote && item && (picked === 'ask' || picked === 'rewrite')) onAsk?.({ kind: picked, quote: words, note: item.title })
  }

  return (
    <main
      className="desk-mat"
      aria-label="Desk"
      ref={mat}
      data-panning={gesture?.kind === 'pan' || undefined}
      data-focus={inFocus ? true : undefined}
      data-gesture={gesture?.kind}
      style={{
        backgroundSize: `${GRID * shownView.zoom}px ${GRID * shownView.zoom}px`,
        backgroundPosition: `${shownView.x}px ${shownView.y}px`,
      }}
      data-hand={hand || undefined}
      onContextMenu={(event) => void contextMenu(event)}
      onPointerDownCapture={(event) => {
        // With the hand on, a drag anywhere on the desk moves it, over sheets too.
        if (!hand || inFocus || event.button !== 0) return
        if ((event.target as HTMLElement).closest('.desk-nav, .selection-bar, .that-tray, .desk-error')) return
        event.preventDefault()
        event.stopPropagation()
        setGesture({ kind: 'pan', from: onScreen(event), start: view })
      }}
      onPointerDown={(event) => {
        if (inFocus) return
        if (event.button === 1 || (event.button === 0 && space.current)) {
          event.preventDefault()
          setGesture({ kind: 'pan', from: onScreen(event), start: view })
          return
        }
        if (event.target !== event.currentTarget || event.button !== 0) return
        const base = event.shiftKey ? new Set(selected) : new Set<string>()
        setSelected(base)
        setActive(undefined)
        setGesture({ kind: 'marquee', from: point(event), base })
      }}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget && !inFocus) addSheet()
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = event.dataTransfer.types.includes(SHELF_DRAG) ? 'move' : 'copy'
      }}
      onDrop={(event) => {
        event.preventDefault()
        // A card from Focus's shelf: read it beside the focused sheet.
        const fromShelf = event.dataTransfer.getData(SHELF_DRAG)
        if (fromShelf) return pinBeside(fromShelf)
        const at = point(event)
        const paths = [...event.dataTransfer.files].map((file) => window.carrel.pathForFile(file)).filter((path) => path.length > 0)
        if (paths.length > 0) return addSources(api.addFiles(paths), at)
        const url = linkIn(event.dataTransfer.getData('text/uri-list').split('\n')[0] ?? '') ?? linkIn(event.dataTransfer.getData('text/plain'))
        if (url) addLink(url, at)
      }}
    >
      {loaded && sheets.length === 0 && (
        <p className="desk-empty">
          <span className="desk-empty-title">{name} is empty.</span>
          Add a book, a video or a web page to start, or double-click for a blank sheet.
        </p>
      )}
      <div
        className="desk-world"
        style={{ transform: `translate(${shownView.x}px, ${shownView.y}px) scale(${shownView.zoom})`, ['--zoom' as string]: shownView.zoom }}
      >
        {mounted.map((sheet) => {
          const box = footprint(sheet)
          const isSelected = selected.has(sheet.id)
          const lifted = gesture?.kind === 'move' && gesture.moved && gesture.ids.has(sheet.id)
          const stack = sheet.pile === undefined ? undefined : stacks.get(sheet.pile)
          const item = sheet.itemId === null ? undefined : items.get(sheet.itemId)
          const title = item?.title ?? (sheet.itemId === null ? 'Blank sheet' : 'Missing source')
          return (
            <section
              key={sheet.id}
              className="sheet"
              data-sheet={sheet.id}
              onPointerDownCapture={(event) => {
                // ⌥-drag (Alt-drag) over a source draws a region to point at.
                if (!event.altKey || event.button !== 0 || sheet.itemId === null) return
                event.preventDefault()
                event.stopPropagation()
                setRegion(undefined)
                setGesture({ kind: 'region', sheet: sheet.id, from: point(event) })
              }}
              data-selected={isSelected || undefined}
              data-lifted={lifted || undefined}
              data-pile-top={stack?.at(-1) === sheet || undefined}
              aria-label={title}
              data-kind={item?.kind}
              data-folded={sheet.folded || undefined}
              data-focused={sheet.id === focused || undefined}
              style={{ left: box.x, top: box.y, width: box.w, height: box.h, zIndex: sheet.z }}
            >
              <div className="sheet-paper" style={{ width: sheet.w, height: sheet.folded ? FOLDED_H : sheet.h, transform: `scale(${sheet.scale})` }}>
                <div
                  className="sheet-label"
                  onPointerDown={(event) => startMove(event, sheet.id)}
                  onDoubleClick={(event) => {
                    if (sheet.id === focused || (event.target as HTMLElement).closest('button')) return
                    enterFocus(sheet.id)
                  }}
                >
                  {item && <span className="sheet-kind">{kindLabel(item)}</span>}
                  <span className="sheet-title">{title}</span>
                  {item && citedBy.has(item.id) && (
                    <span className="cited-by" onPointerDown={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        aria-expanded={backlinks === sheet.id}
                        onClick={() => {
                          const notes = citedBy.get(item.id)!
                          if (notes.length === 1) showItem(notes[0]!, false)
                          else setBacklinks(backlinks === sheet.id ? undefined : sheet.id)
                        }}
                      >
                        {citedBy.get(item.id)!.length === 1 ? '1 note' : `${citedBy.get(item.id)!.length} notes`}
                      </button>
                      {backlinks === sheet.id && (
                        <span className="cited-by-menu" role="menu">
                          {citedBy.get(item.id)!.map((note) => (
                            <button
                              type="button"
                              role="menuitem"
                              key={note.id}
                              onClick={() => {
                                setBacklinks(undefined)
                                showItem(note, false)
                              }}
                            >
                              {note.title}
                            </button>
                          ))}
                        </span>
                      )}
                    </span>
                  )}
                  {positions.has(sheet.id) && <span className="position">{positions.get(sheet.id)}</span>}
                  {asWebPage(item) && !sheet.folded ? (
                    <span className="web-tools" onPointerDown={(event) => event.stopPropagation()}>
                      {loading.get(sheet.id)?.error && (
                        <>
                          <span className="web-error" title={loading.get(sheet.id)?.error}>
                            Couldn't load
                          </span>
                          <button type="button" onClick={() => window.carrel.web.reload(sheet.id)}>
                            Reload
                          </button>
                        </>
                      )}
                      <button type="button" aria-label="Zoom page out" title={withShortcut(frame, 'Zoom page out', 'zoom-out')} onClick={() => void zoomPage(sheet.id, -1)}>
                        −
                      </button>
                      <button type="button" className="position" aria-label="Page zoom" title={withShortcut(frame, 'Actual size', 'actual-size')} onClick={() => void zoomPage(sheet.id, 'actual')}>
                        {Math.round((sheet.pageZoom ?? 1) * 100)}%
                      </button>
                      <button type="button" aria-label="Zoom page in" title={withShortcut(frame, 'Zoom page in', 'zoom-in')} onClick={() => void zoomPage(sheet.id, 1)}>
                        +
                      </button>
                      <button type="button" title="Fit the page's width to the sheet" disabled={live !== sheet.id} onClick={() => void zoomPage(sheet.id, 'fit')}>
                        Fit
                      </button>
                    </span>
                  ) : (
                    <span className="position">{Math.round(sheet.scale * 100)}%</span>
                  )}
                  {!inFocus && (
                    <button
                      type="button"
                      className="sheet-fold"
                      aria-label={sheet.folded ? `Open ${title}` : `Fold ${title}`}
                      title={sheet.folded ? 'Open' : 'Fold to its label'}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => foldOne(sheet.id)}
                    >
                      {sheet.folded ? '+' : '–'}
                    </button>
                  )}
                  {inFocus && sheet.id !== inFocus.id && (
                    <button
                      type="button"
                      className="sheet-fold"
                      aria-label={`Back to the shelf: ${title}`}
                      title="Back to the shelf"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => unpin(sheet.id)}
                    >
                      ×
                    </button>
                  )}
                  {loading.get(sheet.id)?.loading && <span className="web-loading" role="progressbar" aria-label="Loading page" />}
                </div>
                {sheet.folded ? null : item?.kind === 'note' ? (
                  <NoteView
                    item={item}
                    write={writing === item.id}
                    onSaved={(saved) => onItemsAdded([saved])}
                    cites={citesLine(item.cites, items)}
                    notes={notesList}
                    onOpenLink={onOpenLink}
                    onOpenThat={(id) => {
                      const that = thats.find((known) => known.id === id)
                      if (that) openThat(that)
                    }}
                  />
                ) : item?.file && isDocumentFile(item.file.name) ? (
                  <DocView
                    sheet={sheet.id}
                    itemId={item.id}
                    thats={thatsOf(item.id)}
                    focus={focus?.sheet === sheet.id ? focus : undefined}
                    goTo={goTo?.sheet === sheet.id ? goTo : undefined}
                    zoom={sheet.pageZoom ?? 1}
                    onZoom={(how) => void zoomPage(sheet.id, how === 'fit' ? 'actual' : how)}
                    onPage={(page) => reportPosition(sheet.id, page)}
                    onFound={found}
                    bookmarks={item.bookmarks ?? []}
                    keys={focused ? focused === sheet.id : selected.size === 1 && selected.has(sheet.id)}
                    onBookmark={(page, label) =>
                      void api.setBookmark(item.id, page, label).then(
                        (kept) => onItemsAdded([kept]),
                        (reason: unknown) => setError(message(reason)),
                      )
                    }
                  />
                ) : item?.file ? (
                  <PdfView
                    sheet={sheet.id}
                    itemId={item.id}
                    width={sheet.w}
                    detail={sheet.scale * shownView.zoom}
                    thats={thatsOf(item.id)}
                    focus={focus?.sheet === sheet.id ? focus : undefined}
                    goTo={goTo?.sheet === sheet.id ? goTo : undefined}
                    zoom={sheet.pageZoom ?? 1}
                    onZoom={(how) => void zoomPage(sheet.id, how === 'fit' ? 'actual' : how)}
                    onPage={(page) => reportPosition(sheet.id, page)}
                    onFound={found}
                    bookmarks={item.bookmarks ?? []}
                    keys={focused ? focused === sheet.id : selected.size === 1 && selected.has(sheet.id)}
                    onBookmark={(page, label) =>
                      void api.setBookmark(item.id, page, label).then(
                        (kept) => onItemsAdded([kept]),
                        (reason: unknown) => setError(message(reason)),
                      )
                    }
                  />
                ) : item?.kit ? (
                  <KitView
                    item={{ ...item, kit: item.kit }}
                    onActivate={() => setSelected(new Set([sheet.id]))}
                  />
                ) : embedded(item) ? (
                  <VideoView
                    sheet={sheet.id}
                    item={item}
                    onTime={(at) => reportPosition(sheet.id, at)}
                    onTitle={(named) => void api.sourceTitle(item.id, named).then((renamed) => renamed && onItemsAdded([renamed]))}
                  />
                ) : asWebPage(item) ? (
                  <WebPage
                    item={item}
                    snapshot={snapshots.get(item.id)}
                    live={live === sheet.id}
                    waiting={active === sheet.id && live !== sheet.id && gesture === undefined}
                    onActivate={() => {
                      setActive(sheet.id)
                      setSelected(new Set([sheet.id]))
                    }}
                  />
                ) : item && (
                  <div className="source-face">
                    <h3>{item.title}</h3>
                    <p className="position">{sourceLine(item)}</p>
                    {item.url && <p className="source-url">{item.url}</p>}
                  </div>
                )}
              </div>
            </section>
          )
        })}
        {!inFocus && [...stacks].map(([pile, stack]) => {
          const first = stack[0]!
          return (
            <div
              key={pile}
              className="pile-label"
              style={{ left: first.x, top: first.y - PILE_LABEL, zIndex: stack.at(-1)!.z }}
              onPointerDown={(event) => startMove(event, first.id)}
            >
              Pile · {stack.length} <span className="position">{Math.round(first.scale * 100)}%</span>
            </div>
          )
        })}
        {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        {region && !capturing && (
          <div className="that-region" style={{ left: region.rect.x, top: region.rect.y, width: region.rect.w, height: region.rect.h }} />
        )}
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
      </div>
      {single &&
        !single.folded &&
        (() => {
          const box = rectToScreen(view, footprint(single))
          return (
            <div className="handles" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
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
      {around && (
        <div
          className="selection-bar"
          role="toolbar"
          aria-label="Actions for the selection"
          style={barPlace(around, mat.current?.clientHeight ?? Infinity)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="selection-count">{chosen.length} selected</span>
          {chosen.length === 1 && (
            <button type="button" className="main" title={withShortcut(frame, 'Fill the desk with it', 'focus')} onClick={() => enterFocus(chosen[0]!.id)}>
              Focus
            </button>
          )}
          {onePile !== undefined && chosen.length === stacks.get(onePile)?.length ? (
            <button type="button" className="main" onClick={() => spreadSelected(onePile)}>
              Spread out
            </button>
          ) : chosen.length >= 2 ? (
            <button type="button" className="main" onClick={pileSelected}>
              Make a pile
            </button>
          ) : null}
          {hasPile ? null : scaling ? (
            SCALES.map((scale) => {
              const current = chosen.every((sheet) => sheet.scale === scale)
              return (
                <button key={scale} type="button" className={current ? 'main' : undefined} aria-pressed={current} onClick={() => scaleSelected(scale)}>
                  {Math.round(scale * 100)}%
                </button>
              )
            })
          ) : (
            <button type="button" onClick={() => setScaling(true)}>
              Scale
            </button>
          )}
          <button type="button" onClick={foldSelected}>
            {chosen.every((sheet) => sheet.folded) ? 'Open' : 'Fold'}
          </button>
          <button type="button" title={withShortcut(frame, 'Take off this desk; it stays in the library', 'remove')} onClick={removeSelected}>
            Remove
          </button>
          {chosen.length === 1 && chosen[0]?.itemId != null && !['note', 'kit'].includes(items.get(chosen[0].itemId)?.kind ?? '') && !chosen[0].folded && (
            // Pressing it mustn't clear the text selection it points at.
            <button type="button" className="that" title={withShortcut(frame, 'Point at the selected words, the moment or the region', 'that')} onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => void pointAt()}>
              that.
            </button>
          )}
        </div>
      )}
      {inFocus && (
        <>
          <div className="focus-bar" role="toolbar" aria-label="Focus">
            <strong>Focus</strong>
            <span>Everything else waits on the shelf below. Drag a card up to keep it beside.</span>
            <button type="button" onClick={leaveFocus}>
              Back to desk <kbd>Esc</kbd>
            </button>
          </div>
          <nav className="focus-shelf" aria-label="On this desk">
            <span className="focus-shelf-label">On this desk</span>
            <ul>
              {shelf.map((sheet) => {
                const item = sheet.itemId === null ? undefined : items.get(sheet.itemId)
                return (
                  <li key={sheet.id}>
                    <button
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(SHELF_DRAG, sheet.id)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onClick={() => enterFocus(sheet.id)}
                    >
                      <span className="sheet-kind">{item ? kindLabel(item) : 'Sheet'}</span>
                      <span className="focus-card-title">{item?.title ?? (sheet.itemId === null ? 'Blank sheet' : 'Missing source')}</span>
                    </button>
                    <button
                      type="button"
                      className="focus-pin"
                      aria-label={`Keep beside: ${item?.title ?? 'Blank sheet'}`}
                      title="Keep it beside the focused sheet"
                      onClick={() => pinBeside(sheet.id)}
                    >
                      Beside
                    </button>
                  </li>
                )
              })}
              {shelf.length === 0 && <li className="focus-shelf-empty">Nothing else on this desk.</li>}
            </ul>
          </nav>
        </>
      )}
      {!inFocus && (
        <DeskNav
          view={view}
          screen={screen}
          sheets={sheets.map(footprint)}
          onView={setView}
          hand={hand}
          onHand={() => setHand((on) => !on)}
          onZoom={zoomBy}
          onActualSize={actualSize}
          onFit={fit}
          onTidy={tidyUp}
          onAddSheet={addSheet}
          onAddNote={addNote}
          onAddFiles={addFiles}
          onAddLink={addLink}
          onAddKit={addKit}
        />
      )}
      <ThatTray thats={tray} items={items} lost={lost} onOpen={openThat} onRemove={removeThat} />
      {savedCopy && (
        <SavedThat that={savedCopy} item={items.get(savedCopy.itemId)} changed={lost.has(savedCopy.id) || !items.has(savedCopy.itemId)} onClose={() => setSavedCopy(undefined)} />
      )}
      {error && (
        <p className="desk-error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}

/**
 * Where Focus's sheets sit, at 100% between the bar and the shelf: the focused
 * one alone across the middle, or side by side with those kept beside it,
 * sharing the width (the focused one a little wider).
 */
function focusLayout(sheets: readonly Sheet[], screen: { w: number; h: number }): Sheet[] {
  const top = FOCUS_BAR + 16
  const h = Math.max(200, screen.h - top - FOCUS_SHELF - FOCUS_MARGIN)
  const room = Math.max(320, screen.w - FOCUS_MARGIN * 2)
  const gap = 16
  // The focused sheet's share counts 1.5 when others are beside it.
  const shares = sheets.map((_, i) => (i === 0 && sheets.length > 1 ? 1.5 : 1))
  const total = shares.reduce((sum, share) => sum + share, 0)
  const free = room - gap * (sheets.length - 1)
  const widths = sheets.length === 1 ? [Math.min(FOCUS_MAX_W, room)] : shares.map((share) => Math.max(240, Math.floor((free * share) / total)))
  const used = widths.reduce((sum, w) => sum + w, 0) + gap * (sheets.length - 1)
  let x = Math.round((screen.w - used) / 2)
  return sheets.map((sheet, i) => {
    const shown: Sheet = { ...sheet, x, y: top, w: widths[i]!, h, scale: 1 }
    delete shown.folded
    delete shown.pile
    x += widths[i]! + gap
    return shown
  })
}

/** The part of `rect` inside `bounds`. */
function clip(rect: Rect, bounds: Rect): Rect {
  const x = Math.max(rect.x, bounds.x)
  const y = Math.max(rect.y, bounds.y)
  return { x, y, w: Math.max(0, Math.min(rect.x + rect.w, bounds.x + bounds.w) - x), h: Math.max(0, Math.min(rect.y + rect.h, bounds.y + bounds.h) - y) }
}

/** `inner` in percent of `outer` (both in window pixels), kept inside it. */
function percentOf(inner: DOMRect, outer: DOMRect): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(100, ((inner.left - outer.left) / outer.width) * 100))
  const y = Math.max(0, Math.min(100, ((inner.top - outer.top) / outer.height) * 100))
  const right = Math.max(0, Math.min(100, ((inner.right - outer.left) / outer.width) * 100))
  const bottom = Math.max(0, Math.min(100, ((inner.bottom - outer.top) / outer.height) * 100))
  return { x, y, w: right - x, h: bottom - y }
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(reason)
}

/** Under the selection, or above it when there's no room below. */
function barPlace(around: Rect, height: number): { left: number; top: number } {
  const below = around.y + around.h + 12
  return { left: Math.max(8, around.x), top: below + 40 > height ? Math.max(8, around.y - 48) : below }
}
