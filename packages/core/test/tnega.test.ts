import { describe, expect, it } from 'vitest'
import { Context } from 'tnega/core'

// Proves Carrel builds on tnega's published package rather than a fork.
describe('tnega dependency', () => {
  it('creates a tnega Context with its core services', () => {
    const ctx = new Context()
    expect(Context.is(ctx)).toBe(true)
    expect(ctx.events).toBeDefined()
    expect(ctx.registry).toBeDefined()
  })
})
