import { describe, expect, it } from 'vitest'
import { projectNameFrom } from '../src/renderer/first-run.js'

describe('projectNameFrom', () => {
  it('keeps the first clause, without "I am learning"', () => {
    expect(projectNameFrom('I’m reading Mankiw’s Principles and watching the MIT lectures')).toBe('Mankiw’s Principles')
    expect(projectNameFrom('learning economics, from the MIT course')).toBe('Economics')
    expect(projectNameFrom('Studying for the GRE: quant first')).toBe('The GRE')
    expect(projectNameFrom('Rust ownership')).toBe('Rust ownership')
  })

  it('cuts long names at a word, and drops slashes and quotes', () => {
    expect(projectNameFrom('distributed systems consensus algorithms in practice for databases today')).toBe('Distributed systems consensus algorithms')
    expect(projectNameFrom('"KV cache" / paged attention')).toBe('KV cache paged attention')
  })

  it('gives nothing for nothing', () => {
    expect(projectNameFrom('   ')).toBe('')
    expect(projectNameFrom('I am learning')).toBe('')
  })
})
