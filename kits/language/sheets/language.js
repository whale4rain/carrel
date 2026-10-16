// What the language kit's sheets share: the stages, cards, and the numbers
// that say when a learner might move on. Plain functions, so they can be
// tested outside a page; the pages pass in `kit`.

export const STAGES = [
  {
    id: 'beginner',
    title: 'Beginner',
    does: 'A short lesson each day, and a speaking drill.',
    agent: 'The agent teaches, one small step at a time.',
    next: 'Move on when lessons feel easy and most answers are right.',
  },
  {
    id: 'intermediate',
    title: 'Intermediate',
    does: 'A vocabulary deck built from your own that.s, and graded readers.',
    agent: 'The agent coaches: what to review, what to read next.',
    next: 'Move on when you keep most of your deck and look words up less.',
  },
  {
    id: 'advanced',
    title: 'Advanced',
    does: 'Mock tests against a target, and native material.',
    agent: 'The agent examines and edits.',
    next: 'Keep going until your test results reach your target.',
  },
]

/** The stage the learner is at; beginner until they move it. */
export async function stageOf(kit) {
  const saved = await kit.store.get('progress', 'stage')
  return STAGES.find((stage) => stage.id === saved?.stage) ?? STAGES[0]
}

/** Only the learner moves the stage. */
export async function moveTo(kit, id) {
  if (!STAGES.some((stage) => stage.id === id)) throw new Error(`There is no ${id} stage.`)
  await kit.store.set('progress', 'stage', { stage: id, since: new Date().toISOString() })
}

/** A card's id from its words, so the same word isn't added twice. */
export function cardId(front) {
  const words = front.trim().toLowerCase().normalize('NFC')
  let hash = 0
  for (const char of words) hash = (Math.imul(hash, 31) + char.codePointAt(0)) | 0
  return `card-${(hash >>> 0).toString(36)}`
}

/** A new card, from what the learner typed and the that. it came from, if any. */
export function newCard(front, back, that) {
  const card = { front: front.trim(), back: back.trim(), added: new Date().toISOString(), srs: null }
  if (that) card.that = { id: that.id, label: that.label, source: that.source }
  return card
}

/** That.s that point at a few words: good cards. Longer passages are left out. */
export function wordThats(thats, cards) {
  const used = new Set(cards.map((card) => card.value.that?.id).filter(Boolean))
  return thats.filter((that) => that.text && that.text.trim().split(/\s+/).length <= 6 && !used.has(that.id))
}

/** Cards due by `now`, the most overdue first; new cards after them. */
export function dueCards(cards, now = new Date()) {
  const due = cards.filter((card) => card.value.srs && Date.parse(card.value.srs.due) <= now.getTime())
  due.sort((a, b) => Date.parse(a.value.srs.due) - Date.parse(b.value.srs.due))
  return [...due, ...cards.filter((card) => !card.value.srs)]
}

/** When a card is next due, in words. */
export function dueLabel(card, now = new Date()) {
  if (!card.srs) return 'new'
  const ms = Date.parse(card.srs.due) - now.getTime()
  if (ms <= 0) return 'due'
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `in ${minutes} min`
  const days = Math.round(ms / 86400000)
  if (days < 1) return 'later today'
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

/** The most recent reviews kept for the numbers. */
export const KEEP_REVIEWS = 200

/** Adds a review to the history kept in progress/reviews. */
export async function remember(kit, grade) {
  const history = (await kit.store.get('progress', 'reviews')) ?? { reviews: [] }
  history.reviews = [...history.reviews, { at: new Date().toISOString(), grade }].slice(-KEEP_REVIEWS)
  await kit.store.set('progress', 'reviews', history)
}

/**
 * The learner's numbers: cards in the deck, due now, reviews in the last
 * week, and how many of the last 50 reviews were remembered.
 */
export function numbers(cards, reviews, now = new Date()) {
  const week = now.getTime() - 7 * 86400000
  const recent = reviews.slice(-50)
  const kept = recent.filter((review) => review.grade !== 'again').length
  return {
    cards: cards.length,
    due: dueCards(cards, now).filter((card) => card.value.srs).length,
    week: reviews.filter((review) => Date.parse(review.at) >= week).length,
    retention: recent.length >= 10 ? Math.round((kept / recent.length) * 100) : null,
  }
}

/** The sentence around a *that.*'s words, from the words its quote kept on each side. */
export function sentenceOf(around, words) {
  if (!around) return ''
  const sentences = around.split(/(?<=[.!?…])\s+/)
  const found = sentences.find((sentence) => sentence.toLowerCase().includes(words.toLowerCase()))
  return (found ?? around).trim()
}

/** What the kit asks the agent for a card's meaning: the words, and the sentence they came from, so it picks the right sense. */
export function meaningQuestion(words, around) {
  const sentence = sentenceOf(around, words)
  const where = sentence && sentence !== words ? ` in this sentence: “${sentence}”` : ''
  return `What does “${words}” mean${where}? Give a short meaning in English, a few words, as a dictionary would.`
}
