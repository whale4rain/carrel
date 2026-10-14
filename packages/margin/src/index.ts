export { tokens, type ColorToken, type TypeStyle } from './generated/tokens.js'

export const themes = ['day', 'night'] as const
export type Theme = (typeof themes)[number]

export function isTheme(value: string): value is Theme {
  return (themes as readonly string[]).includes(value)
}

/** WCAG contrast ratio between two #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    const [r = 0, g = 0, bl = 0] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
