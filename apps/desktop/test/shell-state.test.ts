import { carrelRoots, Workspace } from '@carrel/core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShellController } from '../src/main/shell-state.js'

let home: string
const controller = (): ShellController => new ShellController(new Workspace(carrelRoots(home)))

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'carrel-shell-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('ShellController', () => {
  it('starts with nothing open', async () => {
    expect(await controller().state()).toEqual({ projects: [] })
  })

  it('opens a new project at its first desk', async () => {
    const state = await controller().createProject('Learn economics')
    expect(state.projects).toEqual(['Learn economics'])
    expect(state.open?.desks.map((desk) => desk.name)).toEqual(['First desk'])
    expect(state.open?.desk).toBe(state.open?.desks[0]?.id)
  })

  it('comes back to the same project and desk after a restart', async () => {
    await controller().createProject('Learn economics')
    const created = await controller().createDesk('Elasticity')
    const elasticity = created.open?.desks.find((desk) => desk.name === 'Elasticity')
    expect(created.open?.desk).toBe(elasticity?.id)

    await controller().createProject('Statistics basics')
    await controller().openProject('Learn economics')

    const restarted = await controller().state()
    expect(restarted.open?.project).toBe('Learn economics')
    expect(restarted.open?.desk).toBe(elasticity?.id)
  })

  it('switches desks and projects', async () => {
    const first = await controller().createProject('Learn economics')
    await controller().createDesk('Elasticity')
    const firstDesk = first.open?.desks[0]?.id ?? ''
    expect((await controller().openDesk(firstDesk)).open?.desk).toBe(firstDesk)

    const other = await controller().createProject('Statistics basics')
    expect(other.open?.project).toBe('Statistics basics')
    expect(other.projects).toEqual(['Learn economics', 'Statistics basics'])
  })

  it('refuses a desk from elsewhere and a desk without a project', async () => {
    await expect(controller().createDesk('Elasticity')).rejects.toThrow(/Create a project first/)
    await controller().createProject('Learn economics')
    await expect(controller().openDesk('not-a-desk')).rejects.toThrow(/not in this project/)
  })
})
