import type { SheetBox } from './geometry.js'

/** One undoable step: the desk before and after it, and what it was. */
export interface Step<T extends SheetBox> {
  kind: string
  before: readonly T[]
  after: readonly T[]
}

/** Undo and redo stacks for one desk. Immutable; every call returns a new history. */
export interface History<T extends SheetBox> {
  past: readonly Step<T>[]
  future: readonly Step<T>[]
}

/** How many steps a desk keeps. */
export const HISTORY_LIMIT = 200

export function emptyHistory<T extends SheetBox>(): History<T> {
  return { past: [], future: [] }
}

/** Records a new step. Doing something new clears what could be redone. */
export function record<T extends SheetBox>(history: History<T>, step: Step<T>): History<T> {
  return { past: [...history.past, step].slice(-HISTORY_LIMIT), future: [] }
}

/** Takes back the last step: the desk to show and the history after it, or nothing to undo. */
export function undo<T extends SheetBox>(history: History<T>): { step: Step<T>; sheets: readonly T[]; history: History<T> } | undefined {
  const step = history.past.at(-1)
  if (!step) return undefined
  return { step, sheets: step.before, history: { past: history.past.slice(0, -1), future: [step, ...history.future] } }
}

/** Does the last undone step again. */
export function redo<T extends SheetBox>(history: History<T>): { step: Step<T>; sheets: readonly T[]; history: History<T> } | undefined {
  const step = history.future[0]
  if (!step) return undefined
  return { step, sheets: step.after, history: { past: [...history.past, step], future: history.future.slice(1) } }
}

/** Ids of sheets added, removed or changed between two desks. */
export function touched<T extends SheetBox>(before: readonly T[], after: readonly T[]): string[] {
  const old = new Map(before.map((sheet) => [sheet.id, JSON.stringify(sheet)]))
  const ids: string[] = []
  for (const sheet of after) {
    if (old.get(sheet.id) !== JSON.stringify(sheet)) ids.push(sheet.id)
    old.delete(sheet.id)
  }
  return [...ids, ...old.keys()]
}

/** The desk without the chosen sheets. */
export function remove<T extends SheetBox>(sheets: readonly T[], ids: ReadonlySet<string>): T[] {
  return sheets.filter((sheet) => !ids.has(sheet.id))
}
