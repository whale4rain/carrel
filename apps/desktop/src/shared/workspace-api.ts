// What the renderer sees of projects and desks, and how it asks for changes.
// Main owns the files; the renderer only gets this summary back.

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

export interface WorkspaceApi {
  state(): Promise<ShellState>
  createProject(name: string): Promise<ShellState>
  openProject(name: string): Promise<ShellState>
  createDesk(name: string): Promise<ShellState>
  openDesk(id: string): Promise<ShellState>
}

export const workspaceChannels = {
  state: 'workspace:state',
  createProject: 'workspace:create-project',
  openProject: 'workspace:open-project',
  createDesk: 'workspace:create-desk',
  openDesk: 'workspace:open-desk',
} as const satisfies Record<keyof WorkspaceApi, string>

/** Replies over IPC carry the error message instead of throwing, so it reaches the renderer intact. */
export type WorkspaceReply = { state: ShellState } | { error: string }
