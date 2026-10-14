// What the shell shows until projects and desks come from disk
// (milestone 1, task 4): one fresh project with three empty desks.

export interface ShellProject {
  name: string
  desks: string[]
  pinnedNotes: string[]
  noteCount: number
  tags: string[]
  sideThreads: string[]
  unread: number
  library: { books: number; videos: number; pages: number; agent: number }
}

export const sampleProject: ShellProject = {
  name: 'Learn economics',
  desks: ['Elasticity', 'Supply & demand', 'Comparing textbooks'],
  pinnedNotes: [],
  noteCount: 0,
  tags: [],
  sideThreads: [],
  unread: 0,
  library: { books: 0, videos: 0, pages: 0, agent: 0 },
}

/** Two letters for the project mark: the first letters of the first two words. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '') : name.trim().slice(0, 2)
  return letters.toUpperCase()
}
