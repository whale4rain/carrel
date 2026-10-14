/** Two letters for the project mark: the first letters of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '') : name.trim().slice(0, 2)
  return letters.toUpperCase()
}
