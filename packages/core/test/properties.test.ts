import { describe, expect, it } from 'vitest'
import { cleanPropertyName, formatProperty, isPropertyValue, parseProperty, propertyKind } from '../src/index.js'

describe('note properties', () => {
  it('reads the YAML other apps write', () => {
    expect(parseProperty('status: Learning')).toEqual({ key: 'status', value: 'Learning' })
    expect(parseProperty('next review: 2026-10-21')).toEqual({ key: 'next review', value: '2026-10-21' })
    expect(parseProperty('hours: 3.5')).toEqual({ key: 'hours', value: 3.5 })
    expect(parseProperty('done: false')).toEqual({ key: 'done', value: false })
    expect(parseProperty('aliases:\n  - surplus\n  - "CS: short"')).toEqual({ key: 'aliases', value: ['surplus', 'CS: short'] })
    expect(parseProperty("tags: [micro, 'exam prep']")).toEqual({ key: 'tags', value: ['micro', 'exam prep'] })
    expect(parseProperty('empty:')).toEqual({ key: 'empty', value: '' })
    expect(parseProperty('nested:\n  a: 1')).toBeUndefined()
    expect(parseProperty('text: |')).toBeUndefined()
  })

  it('writes values that read back the same', () => {
    for (const value of ['Learning', '3', 'true', 'a: b', '#hash', ' padded', '', 'x #y', '2026-10-21', 3, -1.5, true, ['a', 'b: c', '7'], []]) {
      expect(parseProperty(formatProperty('key', value))).toEqual({ key: 'key', value })
    }
    expect(formatProperty('status', 'Learning')).toBe('status: Learning')
    expect(formatProperty('aliases', ['surplus'])).toBe('aliases:\n  - surplus')
  })

  it('tells kinds apart and checks names and values', () => {
    expect([propertyKind('x'), propertyKind('2026-01-02'), propertyKind(1), propertyKind(true), propertyKind([])]).toEqual(['text', 'date', 'number', 'checkbox', 'list'])
    expect(cleanPropertyName(' next review ')).toBe('next review')
    expect(() => cleanPropertyName('a: b')).toThrow("can't be a property name")
    expect(() => cleanPropertyName('-x')).toThrow("can't be a property name")
    expect(isPropertyValue('one line')).toBe(true)
    expect(isPropertyValue('two\nlines')).toBe(false)
    expect(isPropertyValue(Number.NaN)).toBe(false)
    expect(isPropertyValue(['a', 1])).toBe(false)
  })
})
