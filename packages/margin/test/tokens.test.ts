import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateCss, generateModule, resolveColors, withBundledFonts, type TokensJson } from '../src/generate.ts'
import { contrast, tokens } from '../src/index.ts'

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
const json = JSON.parse(await readFile(at('../../../.agent/design/margin/tokens.json'), 'utf8')) as TokensJson

describe('generated tokens', () => {
  it('are up to date with the design system (run `pnpm --filter @carrel/margin tokens`)', async () => {
    expect(await readFile(at('../src/generated/tokens.css'), 'utf8')).toBe(generateCss(json))
    expect(await readFile(at('../src/generated/tokens.ts'), 'utf8')).toBe(generateModule(json))
  })

  it('resolve references between colors', () => {
    expect(resolveColors(json).dark.get('focus')).toBe(resolveColors(json).dark.get('ink'))
  })

  it('cover every color in both themes', () => {
    for (const value of Object.values(tokens.colors)) {
      expect(value.day).toMatch(/^#[0-9a-f]{6}$/i)
      expect(value.night).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('put the bundled font right after the first choice', () => {
    expect(withBundledFonts('Literata, Georgia, serif')).toBe('Literata, "Literata Variable", Georgia, serif')
    expect(withBundledFonts('system-ui, sans-serif')).toBe('system-ui, sans-serif')
  })
})

// The pairs the brand book promises, in both themes.
describe.each(['day', 'night'] as const)('contrast in %s', (theme) => {
  const color = (name: keyof typeof tokens.colors): string => tokens.colors[name][theme]
  it.each([
    ['ink', 'paper', 7],
    ['ink', 'mat', 7],
    ['ink-muted', 'paper', 4.5],
    ['pencil', 'paper', 4.5],
    ['pencil', 'pencil-wash', 4.5],
    ['highlight-ink', 'highlight', 7],
    ['ink', 'highlight-soft', 7],
  ] as const)('%s on %s is at least %d:1', (fg, bg, min) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(min)
  })
})
