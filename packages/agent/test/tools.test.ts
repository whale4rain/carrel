import { describe, expect, it } from 'vitest'
import { carrelTools, chip, describeStep, type ProjectAccess } from '../src/index.js'

const made: Array<{ item: string; page: number; quote: string }> = []
const access: ProjectAccess = {
  search: async () => [
    { kind: 'page', id: 'pdf1', itemId: 'pdf1', page: 3, title: 'Principles', snippet: 'price \u0001elasticity\u0002 of demand' },
    { kind: 'that', id: 't1', itemId: 'pdf1', title: 'Principles p.12', snippet: 'habits' },
  ],
  read: async (itemId, pages) => ({ title: 'Principles', kind: 'paper', text: `${itemId} ${JSON.stringify(pages)} ${'x'.repeat(20_000)}`, pages: 40 }),
  that: async (id) => ({ id, item: 'pdf1', source: 'Principles', label: 'p.12', quote: 'Habits are inelastic' }),
  makeThat: async (item, page, quote) => {
    made.push({ item, page, quote })
    return { id: 't9', label: `p.${page}` }
  },
}

const tool = (name: string) => {
  const found = carrelTools(access).find((candidate) => candidate.schema.name === name)
  if (!found) throw new Error(name)
  return (input: unknown) => found.execute(input, {} as never)
}

describe('carrelTools', () => {
  it('searches, with the ids the other tools take and no match marks', async () => {
    expect(await tool('search_project')({ query: 'elasticity' })).toEqual({
      hits: [
        { kind: 'page', title: 'Principles', item: 'pdf1', page: 3, text: 'price elasticity of demand' },
        { kind: 'that.', title: 'Principles p.12', item: 'pdf1', that: 't1', text: 'habits' },
      ],
    })
  })

  it('reads at most ten pages, and cuts long text', async () => {
    const read = (await tool('read_item')({ item: 'pdf1', from_page: 2, to_page: 40 })) as { text: string; cut?: boolean }
    expect(read.text.startsWith('pdf1 {"from":2,"to":11}')).toBe(true)
    expect(read.cut).toBe(true)
    expect(read.text.length).toBe(12_001)
  })

  it('resolves a that. and makes one, giving the chip to cite', async () => {
    expect(await tool('resolve_that')({ that: 't1' })).toMatchObject({ quote: 'Habits are inelastic', cite: '[p.12](that:t1)' })
    expect(await tool('make_that')({ item: 'pdf1', page: 4, quote: 'Demand is elastic' })).toEqual({ that: 't9', cite: '[p.4](that:t9)' })
    expect(made).toEqual([{ item: 'pdf1', page: 4, quote: 'Demand is elastic' }])
    await expect(tool('make_that')({ item: 'pdf1', quote: 'x' })).rejects.toThrow('needs an item')
  })

  it('writes chips and steps in words', () => {
    expect(chip({ id: 'a', label: '' })).toBe('[that.](that:a)')
    expect(describeStep('read_item', { item: 'x', from_page: 2, to_page: 5 })).toBe('Read pages 2–5')
    expect(describeStep('read_item', { item: 'x' })).toBe('Read a note or source')
    expect(describeStep('make_that', { page: 4 })).toBe('Pointed at p.4')
  })
})
