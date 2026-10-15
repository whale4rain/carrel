import { frameFor } from '../shared/frame.js'

/** The frame this window draws (`?frame=` overrides it, for screenshots); shortcuts are written its way. */
export const frame = frameFor(window.carrel.platform, new URLSearchParams(location.search).get('frame') ?? undefined)

/** A menu-bar command for the desk, by its shortcut id; DeskPlane listens. */
export const DESK_COMMAND = 'carrel:desk-command'
