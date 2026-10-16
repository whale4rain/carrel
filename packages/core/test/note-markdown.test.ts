import { describe, expect, it } from 'vitest'
import { citedThats, fromMarkdown, isNoteDoc, linksOf, plainText, tagsOf, toMarkdown, type NoteDoc } from '../src/index.js'

const doc: NoteDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Elasticity' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Coffee: price up, quantity ' },
        { type: 'text', text: 'barely', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' moves, so ' },
        { type: 'text', text: 'inelastic', marks: [{ type: 'bold' }] },
        { type: 'text', text: '. ' },
        { type: 'that', attrs: { id: 'a1', label: '12:34' } },
      ],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rule: |E| > 1 elastic' }] }] },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Few substitutes' }] },
            { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'habits' }] }] }] },
          ],
        },
      ],
    },
    { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Price ' }, { type: 'text', text: 'E', marks: [{ type: 'code' }] }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'hardBreak' }, { type: 'text', text: '# not a heading *or* [link]' }] },
  ],
}

describe('note Markdown', () => {
  it('writes readable Markdown', () => {
    expect(toMarkdown(doc)).toBe(
      [
        '# Elasticity',
        '',
        'Coffee: price up, quantity *barely* moves, so **inelastic**. [12:34](that:a1)',
        '',
        '- Rule: |E| > 1 elastic',
        '- Few substitutes',
        '',
        '  1. habits',
        '',
        '> Price `E`',
        '',
        'one\\',
        '\\# not a heading \\*or\\* \\[link\\]',
        '',
      ].join('\n'),
    )
  })

  it('reads back what it wrote', () => {
    expect(fromMarkdown(toMarkdown(doc))).toEqual(doc)
  })

  it('reads Markdown written by hand', () => {
    const read = fromMarkdown('Some *words*\nwrapped here\n\n* a\n* b\n\n## Next\n- [x] [p.4](that:b2)\n')
    expect(read.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Some ' }, { type: 'text', text: 'words', marks: [{ type: 'italic' }] }, { type: 'text', text: ' wrapped here' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '[x] ' }, { type: 'that', attrs: { id: 'b2', label: 'p.4' } }] }] }] },
    ])
  })

  it('leaves a lone star alone', () => {
    expect(fromMarkdown('2 * 3 = 6').content).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: '2 * 3 = 6' }] }])
  })

  it('finds the plain text and the cited that.s', () => {
    expect(plainText(doc).split('\n')[0]).toBe('Elasticity')
    expect(citedThats(doc)).toEqual(['a1'])
  })

  it('checks documents from the renderer', () => {
    expect(isNoteDoc(doc)).toBe(true)
    expect(isNoteDoc({ type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] })).toBe(false)
    expect(isNoteDoc({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'that', attrs: { id: '../x', label: '' } }] }] })).toBe(false)
  })
})

describe('empty lines', () => {
  it('leaves an empty title and blank paragraphs out', () => {
    const empty: NoteDoc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }, { type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: 'Words' }] }] }
    expect(toMarkdown(empty)).toBe('Words\n')
    expect(toMarkdown({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('')
  })
})

describe('tags', () => {
  it('finds #tags anywhere in the text, once each', () => {
    const tagged = fromMarkdown('# Elasticity #micro\n\nSee #Elasticity and #exam-prep, not a#b or # alone.\n\n- also (#micro)\n')
    expect(tagsOf(tagged)).toEqual(['micro', 'elasticity', 'exam-prep'])
  })
})

describe('links between notes', () => {
  it('reads and writes [[links]] as Obsidian does', () => {
    const read = fromMarkdown('See [[Price ceilings]] and [[Elasticity#Rule of thumb|the rule]], not \\[\\[this\\]\\].')
    expect(read.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ' },
        { type: 'noteLink', attrs: { target: 'Price ceilings', label: '' } },
        { type: 'text', text: ' and ' },
        { type: 'noteLink', attrs: { target: 'Elasticity#Rule of thumb', label: 'the rule' } },
        { type: 'text', text: ', not [[this]].' },
      ],
    })
    expect(toMarkdown(read)).toBe('See [[Price ceilings]] and [[Elasticity#Rule of thumb|the rule]], not \\[\\[this\\]\\].\n')
    expect(plainText(read)).toBe('See Price ceilings and the rule, not [[this]].')
    expect(linksOf(fromMarkdown('[[A]] [[a]] [[B#x]] [[ ]]'))).toEqual(['A', 'B'])
  })

  it('checks links from the renderer', () => {
    const link = (target: string): NoteDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'noteLink', attrs: { target, label: '' } }] }] })
    expect(isNoteDoc(link('Elasticity'))).toBe(true)
    expect(isNoteDoc(link('a]]b'))).toBe(false)
    expect(isNoteDoc(link(''))).toBe(false)
  })
})
