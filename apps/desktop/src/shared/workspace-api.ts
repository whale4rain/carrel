// What the renderer sees of projects and desks, and how it asks for changes.
// Main owns the files; the renderer only gets summaries back.
import type { Sheet, SheetChange, Viewport } from '@carrel/core'

export type { Sheet, SheetChange, Viewport }

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
}

export const workspaceChannels = {
  state: 'workspace:state',
  createProject: 'workspace:create-project',
  openProject: 'workspace:open-project',
  createDesk: 'workspace:create-desk',
  openDesk: 'workspace:open-desk',
  desk: 'workspace:desk',
  saveSheets: 'workspace:save-sheets',
  saveViewport: 'workspace:save-viewport',
} as const satisfies Record<keyof WorkspaceApi, string>

/** Replies over IPC carry the error message instead of throwing, so it reaches the renderer intact. */
export type WorkspaceReply = { value: unknown } | { error: string }
