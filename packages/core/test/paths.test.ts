import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertProjectName, carrelRoots, projectDir } from '../src/index.js'

describe('carrelRoots', () => {
  it('keeps content visible and internals hidden', () => {
    const roots = carrelRoots('/home/ada')
    expect(roots.content).toBe(join('/home/ada', 'Carrel'))
    expect(roots.internal).toBe(join('/home/ada', '.carrel'))
  })
})

describe('projectDir', () => {
  it('puts a project in its own folder under ~/Carrel', () => {
    expect(projectDir('Learn economics', carrelRoots('/home/ada'))).toBe(
      join('/home/ada', 'Carrel', 'Learn economics'),
    )
  })

  it.each(['', '  ', ' padded', '..', 'a/b', 'a\\b', 'what?', 'end.', 'CON', 'lpt1.txt', 'tab\there'])(
    'rejects %j',
    (name) => {
      expect(() => assertProjectName(name)).toThrow()
    },
  )

  it.each(['Learn economics', '日本語の勉強', 'Physics 101', 'console'])('accepts %j', (name) => {
    expect(() => assertProjectName(name)).not.toThrow()
  })
})
