// The first run: a sentence about what you are learning becomes a project's name.

const LEADS = /^(?:i(?:'|’)?m|i am|i'm currently|currently|right now|now)?\s*(?:learning|studying|reading|watching|working through|trying to learn|getting into|into)(?:\s+(?:about|for)\b)?(?:\s+|$)/i
const LONGEST = 40

/**
 * A short project name from a sentence: "I'm reading Mankiw's Principles and
 * the MIT lectures" → "Mankiw's Principles". The first clause, without "I'm
 * learning", capitalized, cut at a word under 40 characters.
 */
export function projectNameFrom(sentence: string): string {
  const first = sentence.split(/[\n.;:,!?(]|\s[-–—]\s|\s+(?:and|from|with|using|because|so)\s+/i)[0] ?? ''
  const plain = first.trim().replace(LEADS, '').replace(/["“”]/g, '').replace(/[/\\]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!plain) return ''
  let name = plain
  if (name.length > LONGEST) {
    const cut = name.slice(0, LONGEST + 1)
    name = cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : LONGEST).trim()
  }
  return name.charAt(0).toUpperCase() + name.slice(1)
}
