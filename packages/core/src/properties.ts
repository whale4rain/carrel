/**
 * A note's properties: the fields in its `---` header besides Carrel's own,
 * written the way Obsidian writes them, so notes keep them both ways:
 *
 *   status: Learning
 *   next review: 2026-10-21
 *   hours: 3
 *   done: false
 *   aliases:
 *     - surplus
 *
 * Only this simple subset of YAML is read: one value per key, or a list.
 * Anything else in the header is kept as it was written.
 */
export type PropertyValue = string | number | boolean | string[]

/** How a property shows and is edited, judged from its value. */
export type PropertyKind = 'text' | 'number' | 'checkbox' | 'date' | 'list'

export type Properties = Record<string, PropertyValue>

const DATE = /^\d{4}-\d{2}-\d{2}$/
const NUMBER = /^-?\d+(\.\d+)?$/

export function propertyKind(value: PropertyValue): PropertyKind {
  if (Array.isArray(value)) return 'list'
  if (typeof value === 'boolean') return 'checkbox'
  if (typeof value === 'number') return 'number'
  return DATE.test(value) ? 'date' : 'text'
}

/** A header key line: anything up to a colon, not starting with a space, "-" or "#". */
export const PROPERTY_KEY = /^([^\s:#'"-][^:\n]*?):(?:\s|$)/

/** A property name, checked: one line, no colon, not starting with "-" or "#", at most 60 characters. */
export function cleanPropertyName(name: string): string {
  const clean = name.trim()
  if (!clean || clean.length > 60 || clean.includes(':') || PROPERTY_KEY.exec(`${clean}: x`)?.[1] !== clean) throw new Error(`"${name}" can't be a property name.`)
  return clean
}

/** One header entry (its key line and any lines under it) as a property, if it is one this reads. */
export function parseProperty(entry: string): { key: string; value: PropertyValue } | undefined {
  const [first, ...rest] = entry.split('\n')
  const match = PROPERTY_KEY.exec(first!)
  if (!match) return undefined
  const key = match[1]!.trim()
  const inline = first!.slice(match[0].length).trim()
  if (rest.length > 0) {
    if (inline !== '') return undefined
    const items: string[] = []
    for (const line of rest) {
      const item = /^\s*-\s+(.*)$/.exec(line) ?? /^\s*-$/.exec(line)
      if (!item) return undefined
      items.push(String(scalar(item[1] ?? '')))
    }
    return { key, value: items.filter((item) => item !== '') }
  }
  if (inline.startsWith('[') && inline.endsWith(']')) {
    const inner = inline.slice(1, -1).trim()
    return { key, value: inner === '' ? [] : splitList(inner).map((item) => String(scalar(item))) }
  }
  if (inline.startsWith('{') || inline.startsWith('|') || inline.startsWith('>')) return undefined
  return { key, value: scalar(inline) }
}

/** A property as header lines. */
export function formatProperty(key: string, value: PropertyValue): string {
  if (Array.isArray(value)) return value.length === 0 ? `${key}: []` : [`${key}:`, ...value.map((item) => `  - ${quoted(item)}`)].join('\n')
  if (typeof value !== 'string') return `${key}: ${String(value)}`
  return `${key}: ${DATE.test(value) ? value : quoted(value)}`
}

/** Text written so it reads back as the same text. */
function quoted(text: string): string {
  const plain = text !== '' && text === text.trim() && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(text) && !/: |\s#/.test(text) && !/^(true|false|null|~|yes|no)$/i.test(text) && !NUMBER.test(text) && !DATE.test(text)
  return plain ? text : JSON.stringify(text)
}

function scalar(raw: string): string | number | boolean {
  const text = raw.trim()
  if (text.startsWith('"')) {
    try {
      return String(JSON.parse(text))
    } catch {
      return text.slice(1, -1)
    }
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'")
  if (/^true$/i.test(text)) return true
  if (/^false$/i.test(text)) return false
  if (NUMBER.test(text)) return Number(text)
  return text
}

/** "a, "b, c", d" as three items, minding quotes. */
function splitList(inner: string): string[] {
  const items: string[] = []
  let current = ''
  let quote: string | undefined
  for (const char of inner) {
    if (quote) {
      current += char
      if (char === quote) quote = undefined
    } else if (char === '"' || char === "'") {
      quote = char
      current += char
    } else if (char === ',') {
      items.push(current)
      current = ''
    } else current += char
  }
  items.push(current)
  return items.map((item) => item.trim()).filter((item) => item !== '')
}

/** Checks a property value from the renderer. */
export function isPropertyValue(value: unknown): value is PropertyValue {
  if (typeof value === 'string') return value.length <= 2000 && !value.includes('\n')
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  return Array.isArray(value) && value.length <= 100 && value.every((item) => typeof item === 'string' && item.length <= 500 && !item.includes('\n'))
}
