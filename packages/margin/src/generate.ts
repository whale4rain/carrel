// Turns Margin's tokens.json (the design system's single source of truth)
// into CSS variables and a typed module. Run `pnpm --filter @carrel/margin
// tokens` after changing tokens.json; a test fails if the output is stale.

type Themed = { light: string; dark: string }

interface TokensJson {
  color: { themes: Array<{ id: 'light' | 'dark'; name: string }>; tokens: Array<{ name: string; value: Themed; usage: string }> }
  type: {
    families: Record<string, string>
    groups: Array<{
      name: string
      family: string
      styles: Array<{ name: string; fontSize: string; lineHeight: string; fontWeight: number; letterSpacing?: string; fontStyle?: string; usage: string }>
    }>
  }
  spacing: { tokens: Array<{ name: string; value: string; usage: string }> }
  radius: { tokens: Array<{ name: string; value: string; usage: string }> }
  shadow: { tokens: Array<{ name: string; value: Themed; usage: string }> }
}

/**
 * Families Carrel bundles (from @fontsource-variable) register under a
 * "<name> Variable" family; they go right after the token's own first choice.
 */
const BUNDLED: Record<string, string> = {
  'Instrument Sans': 'Instrument Sans Variable',
  Literata: 'Literata Variable',
  'JetBrains Mono': 'JetBrains Mono Variable',
}

export function withBundledFonts(stack: string): string {
  const [first, ...rest] = stack.split(',').map((part) => part.trim())
  const name = first?.replace(/^"|"$/g, '') ?? ''
  const bundled = BUNDLED[name]
  return [first, ...(bundled ? [`"${bundled}"`] : []), ...rest].join(', ')
}

/** Resolves `{other}` references between color tokens, per theme. */
export function resolveColors(json: TokensJson): { light: Map<string, string>; dark: Map<string, string> } {
  const out = { light: new Map<string, string>(), dark: new Map<string, string>() }
  for (const theme of ['light', 'dark'] as const) {
    const raw = new Map(json.color.tokens.map((token) => [token.name, token.value[theme]]))
    const resolve = (name: string, seen: Set<string>): string => {
      const value = raw.get(name)
      if (value === undefined) throw new Error(`unknown color token: ${name}`)
      const reference = /^\{([\w-]+)\}$/.exec(value)
      if (!reference?.[1]) return value
      if (seen.has(name)) throw new Error(`color token cycle at ${name}`)
      return resolve(reference[1], new Set([...seen, name]))
    }
    for (const name of raw.keys()) out[theme].set(name, resolve(name, new Set()))
  }
  return out
}

function block(selector: string, lines: string[], indent = ''): string {
  return `${indent}${selector} {\n${lines.map((line) => `${indent}  ${line}`).join('\n')}\n${indent}}`
}

export function generateCss(json: TokensJson): string {
  const colors = resolveColors(json)
  const themed = (theme: 'light' | 'dark'): string[] => [
    `color-scheme: ${theme};`,
    ...[...colors[theme]].map(([name, value]) => `--${name}: ${value};`),
    ...json.shadow.tokens.map((token) => `--${token.name}: ${token.value[theme]};`),
  ]
  const shared: string[] = [
    ...Object.entries(json.type.families).map(([name, stack]) => `--font-${name}: ${withBundledFonts(stack)};`),
    ...json.type.groups.flatMap((group) =>
      group.styles.flatMap((style) => [
        `--text-${style.name}: ${style.fontStyle === 'italic' ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}/${style.lineHeight} var(--font-${group.family});`,
        ...(style.letterSpacing ? [`--text-${style.name}-tracking: ${style.letterSpacing};`] : []),
      ]),
    ),
    ...json.spacing.tokens.map((token) => `--${token.name}: ${token.value};`),
    ...json.radius.tokens.map((token) => `--${token.name}: ${token.value};`),
  ]
  return [
    '/* Generated from Margin tokens.json by @carrel/margin. Do not edit; run `pnpm --filter @carrel/margin tokens`. */',
    '',
    block(':root', shared),
    '',
    '/* Day is the default; data-theme on the root element picks one explicitly. */',
    block(':root,\n[data-theme="day"]', themed('light')),
    '',
    block('[data-theme="night"]', themed('dark')),
    '',
    '/* With no explicit choice, follow the system. */',
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="day"])', themed('dark'), '  ')}\n}`,
    '',
  ].join('\n')
}

export function generateModule(json: TokensJson): string {
  const colors = resolveColors(json)
  const data = {
    colors: Object.fromEntries([...colors.light.keys()].map((name) => [name, { day: colors.light.get(name), night: colors.dark.get(name) }])),
    typeStyles: Object.fromEntries(
      json.type.groups.flatMap((group) =>
        group.styles.map((style) => [
          style.name,
          {
            family: group.family,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            fontWeight: style.fontWeight,
            ...(style.fontStyle ? { fontStyle: style.fontStyle } : {}),
            ...(style.letterSpacing ? { letterSpacing: style.letterSpacing } : {}),
          },
        ]),
      ),
    ),
    spacing: Object.fromEntries(json.spacing.tokens.map((token) => [token.name, token.value])),
    radius: Object.fromEntries(json.radius.tokens.map((token) => [token.name, token.value])),
  }
  return [
    '// Generated from Margin tokens.json by @carrel/margin. Do not edit; run `pnpm --filter @carrel/margin tokens`.',
    '',
    `export const tokens = ${JSON.stringify(data, null, 2)} as const`,
    '',
    'export type ColorToken = keyof typeof tokens.colors',
    'export type TypeStyle = keyof typeof tokens.typeStyles',
    '',
  ].join('\n')
}

export type { TokensJson }
