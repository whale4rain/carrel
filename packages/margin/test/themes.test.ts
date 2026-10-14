import { describe, expect, it } from 'vitest'
import { isTheme, themes } from '../src/index.js'

describe('themes', () => {
  it('has Day and Night', () => {
    expect(themes).toEqual(['day', 'night'])
  })

  it('recognises only known themes', () => {
    expect(isTheme('night')).toBe(true)
    expect(isTheme('sepia')).toBe(false)
  })
})
