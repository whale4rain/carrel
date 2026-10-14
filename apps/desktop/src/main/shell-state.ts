import type { OpenProject, Workspace } from '@carrel/core'
import type { ShellState } from '../shared/workspace-api.js'

/**
 * Turns the workspace on disk into what the shell shows, and remembers what
 * was open in ~/.carrel/settings.json so a restart comes back to it.
 */
export class ShellController {
  private readonly workspace: Workspace

  constructor(workspace: Workspace) {
    this.workspace = workspace
  }

  async state(): Promise<ShellState> {
    const projects = await this.workspace.listProjects()
    const settings = await this.workspace.readSettings()
    const folder = settings.project !== undefined && projects.includes(settings.project) ? settings.project : projects[0]
    if (folder === undefined) return { projects }
    const opened = await this.workspace.openProject(folder)
    const remembered = settings.desks?.[folder]
    const desk = opened.desks.find((entry) => entry.id === remembered) ?? opened.desks[0]
    return { projects, open: summary(opened, desk?.id) }
  }

  async createProject(name: string): Promise<ShellState> {
    const opened = await this.workspace.createProject(name)
    await this.remember(opened.folder, opened.desks[0]?.id)
    return this.state()
  }

  async openProject(name: string): Promise<ShellState> {
    // Each project comes back at the desk it was left on.
    await this.workspace.openProject(name)
    await this.remember(name, undefined)
    return this.state()
  }

  async createDesk(name: string): Promise<ShellState> {
    const folder = await this.openFolder()
    const desk = await this.workspace.createDesk(folder, name)
    await this.remember(folder, desk.id)
    return this.state()
  }

  async openDesk(id: string): Promise<ShellState> {
    const folder = await this.openFolder()
    const opened = await this.workspace.openProject(folder)
    if (!opened.desks.some((desk) => desk.id === id)) throw new Error('That desk is not in this project.')
    await this.remember(folder, id)
    return this.state()
  }

  private async openFolder(): Promise<string> {
    const { open } = await this.state()
    if (!open) throw new Error('Create a project first.')
    return open.project
  }

  private async remember(project: string, desk: string | undefined): Promise<void> {
    const settings = await this.workspace.readSettings()
    const desks = desk === undefined ? settings.desks : { ...settings.desks, [project]: desk }
    await this.workspace.writeSettings({ ...settings, project, ...(desks ? { desks } : {}) })
  }
}

function summary(opened: OpenProject, desk: string | undefined): NonNullable<ShellState['open']> {
  return {
    project: opened.folder,
    desks: opened.desks.map(({ id, name }) => ({ id, name })),
    desk: desk ?? '',
  }
}
