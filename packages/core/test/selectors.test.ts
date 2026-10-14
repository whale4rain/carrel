import { describe, expect, it } from 'vitest'
import { findText, formatMoment, momentOf, momentSelector, pageOf, pageSelector, positionLabel, textSelectors } from '../src/index.js'

const page = 'Elasticity describes how strongly buyers react when a price moves. When a small price change shifts the quantity bought a lot, demand is elastic.'

describe('selectors', () => {
  it('quotes a selection with its context and position', () => {
    const start = page.indexOf('When a small')
    const [quote, position] = textSelectors(page, start, start + 25)
    expect(quote).toEqual({ type: 'TextQuoteSelector', exact: 'When a small price change', prefix: 'uyers react when a price moves. ', suffix: ' shifts the quantity bought a lo' })
    expect(quote.prefix).toHaveLength(32)
    expect(position).toEqual({ type: 'TextPositionSelector', start, end: start + 25 })
    expect(() => textSelectors(page, 5, 5)).toThrow(/not in the text/)
    expect(() => textSelectors(page, 0, page.length + 1)).toThrow(/not in the text/)
  })

  it('names pages and moments', () => {
    expect(pageOf([pageSelector(42)])).toBe(42)
    expect(momentOf([momentSelector(754.34)])).toBe(754.3)
    expect(positionLabel([pageSelector(42)])).toBe('p.42')
    expect(positionLabel([momentSelector(754.34)])).toBe('12:34')
    expect(positionLabel([])).toBe('')
    expect(formatMoment(3725)).toBe('1:02:05')
    expect(() => pageSelector(0)).toThrow(/not a page/)
  })
})

describe('findText', () => {
  const start = page.indexOf('demand is elastic')
  const selectors = textSelectors(page, start, start + 17)

  it('finds a that. where it was', () => {
    expect(findText(page, selectors)).toEqual({ start, end: start + 17, how: 'position' })
  })

  it('finds it by its quote when the text moved', () => {
    const moved = `New first sentence. ${page}`
    expect(findText(moved, selectors)).toEqual({ start: start + 20, end: start + 37, how: 'quote' })
  })

  it('picks the copy whose context matches', () => {
    const twice = `Rarely is demand is elastic said twice. ${page}`
    const found = findText(twice, selectors)
    expect(found?.start).toBe(twice.lastIndexOf('demand is elastic'))
  })

  it('says when the quote is gone', () => {
    expect(findText(page.replace('elastic.', 'inelastic.').replace('demand is', 'it is'), selectors)).toBeUndefined()
  })
})
