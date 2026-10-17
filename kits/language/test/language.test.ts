import { describe, expect, it } from 'vitest'
// @ts-expect-error The kit's pages are plain JavaScript.
import { cardId, dueCards, dueLabel, meaningQuestion, moveTo, newCard, numbers, sentenceOf, stageOf, wordThats } from '../sheets/language.js'

/** A kit bridge with an in-memory store, as the pages see it. */
function fakeKit() {
  const docs = new Map<string, unknown>()
  return {
    store: {
      get: (collection: string, id: string) => Promise.resolve(docs.get(`${collection}/${id}`)),
      set: (collection: string, id: string, value: unknown) => Promise.resolve(void docs.set(`${collection}/${id}`, value)),
    },
  }
}

const now = new Date('2026-10-16T09:00:00Z')
const card = (id: string, srs: { due: string } | null) => ({ id, value: { front: id, back: '', srs } })

describe('the language kit', () => {
  it('starts at Beginner, and only moves where it is told', async () => {
    const kit = fakeKit()
    expect((await stageOf(kit)).id).toBe('beginner')
    await moveTo(kit, 'intermediate')
    expect((await stageOf(kit)).title).toBe('Intermediate')
    await expect(moveTo(kit, 'fluent')).rejects.toThrow('no fluent stage')
  })

  it('gives the same word the same card, whatever its case or spaces', () => {
    expect(cardId(' Hola ')).toBe(cardId('hola'))
    expect(cardId('hola')).not.toBe(cardId('adiós'))
    expect(cardId('hola')).toMatch(/^card-[a-z0-9]+$/)
  })

  it('keeps where a card came from', () => {
    const made = newCard(' la mesa ', ' the table ', { id: 't1', label: 'p.3', source: 'Gramática', text: 'la mesa' })
    expect(made).toMatchObject({ front: 'la mesa', back: 'the table', srs: null, that: { id: 't1', label: 'p.3', source: 'Gramática' } })
    expect(newCard('hola', '')).not.toHaveProperty('that')
  })

  it('offers short that.s not in the deck yet', () => {
    const thats = [
      { id: 't1', label: 'p.1', text: 'la mesa', source: 'A' },
      { id: 't2', label: 'p.2', text: 'Esta es una frase demasiado larga para una tarjeta', source: 'A' },
      { id: 't3', label: '', source: 'A' },
      { id: 't4', label: 'p.4', text: 'el gato', source: 'A' },
    ]
    const cards = [{ id: 'c', value: { front: 'el gato', that: { id: 't4' } } }]
    expect(wordThats(thats, cards).map((that: { id: string }) => that.id)).toEqual(['t1'])
  })

  it('reviews overdue cards first, then new ones', () => {
    const cards = [card('later', { due: '2026-10-20T00:00:00Z' }), card('new', null), card('due', { due: '2026-10-16T08:00:00Z' }), card('older', { due: '2026-10-10T00:00:00Z' })]
    expect(dueCards(cards, now).map((each: { id: string }) => each.id)).toEqual(['older', 'due', 'new'])
    expect(dueLabel({ srs: null }, now)).toBe('new')
    expect(dueLabel({ srs: { due: '2026-10-16T09:10:00Z' } }, now)).toBe('in 10 min')
    expect(dueLabel({ srs: { due: '2026-10-17T09:00:00Z' } }, now)).toBe('tomorrow')
    expect(dueLabel({ srs: { due: '2026-10-19T09:00:00Z' } }, now)).toBe('in 3 days')
  })

  it('counts what says when to move on', () => {
    const reviews = Array.from({ length: 20 }, (_, i) => ({ at: '2026-10-15T09:00:00Z', grade: i < 5 ? 'again' : 'good' }))
    expect(numbers([card('a', { due: '2026-10-10T00:00:00Z' }), card('b', null)], reviews, now)).toEqual({ cards: 2, due: 1, week: 20, retention: 75 })
    expect(numbers([], reviews.slice(0, 5), now).retention).toBeNull()
  })

  it('asks for a meaning with the sentence the words came from', () => {
    const around = 'casa es grande. Pongo el libro en la mesa. Luego abro la'
    expect(sentenceOf(around, 'la mesa')).toBe('Pongo el libro en la mesa.')
    expect(sentenceOf(around, 'nada')).toBe(around)
    expect(sentenceOf(undefined, 'la mesa')).toBe('')
    expect(meaningQuestion('la mesa', around)).toBe('What does “la mesa” mean in this sentence: “Pongo el libro en la mesa.”? Give a short meaning in English, a few words, as a dictionary would.')
    expect(meaningQuestion('la mesa')).toBe('What does “la mesa” mean? Give a short meaning in English, a few words, as a dictionary would.')
    expect(meaningQuestion('la mesa', 'la mesa')).toMatch(/^What does “la mesa” mean\?/)
  })
})
