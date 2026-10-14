// Margin tokens become CSS variables in milestone 1 (task 2), generated from
// the design system's tokens.json. Until then this package only names the
// themes so the rest of the app can depend on it.

export const themes = ['day', 'night'] as const
export type Theme = (typeof themes)[number]

export function isTheme(value: string): value is Theme {
  return (themes as readonly string[]).includes(value)
}
