import { describe, expect, it } from 'vitest'
import { blockText, readDocument, readMarkdown, sectionsOf, sectionTexts, type DocBlock } from '../src/documents.js'

const BOOK = `# Economics

A short book.

## Scarcity

We **can't** have *everything*: see [the notes](https://example.com/notes).

- Time
- Money
  1. Saved
  2. Spent

## Choice

> Every choice gives something up.

\`\`\`
cost = what you give up
\`\`\`

| Good | Price |
| --- | --- |
| Tea | 2 |

<script>alert('no')</script>
`

describe('reading Markdown', () => {
  it('cuts sections at the main headings, keeping a lone title in the first', () => {
    const { sections } = readMarkdown(BOOK, 'Economics')
    expect(sections.map((section) => section.title)).toEqual(['Economics', 'Scarcity', 'Choice'])
    expect(sections[0]!.blocks.map((block) => block.type)).toEqual(['heading', 'paragraph'])
  })

  it('keeps marks and safe links, as plain data', () => {
    const scarcity = readMarkdown(BOOK, 'Economics').sections[1]!
    expect(scarcity.blocks[1]).toEqual({
      type: 'paragraph',
      text: [
        { text: 'We ' },
        { text: "can't", bold: true },
        { text: ' have ' },
        { text: 'everything', italic: true },
        { text: ': see ' },
        { text: 'the notes', href: 'https://example.com/notes' },
        { text: '.' },
      ],
    })
    expect(scarcity.blocks[2]).toMatchObject({ type: 'list', ordered: false })
  })

  it('reads quotes, code, tables, and raw HTML only as words', () => {
    const choice = readMarkdown(BOOK, 'Economics').sections[2]!
    expect(choice.blocks.map((block) => block.type)).toEqual(['heading', 'quote', 'code', 'table', 'paragraph'])
    expect(choice.blocks[4]).toEqual({ type: 'paragraph', text: [{ text: "alert('no')" }] })
  })

  it('gives each section its text, one line per heading, paragraph, item and cell', () => {
    const [, scarcity, choice] = sectionTexts(readMarkdown(BOOK, 'Economics'))
    expect(scarcity).toBe("Scarcity\nWe can't have everything: see the notes.\nTime\nMoney\nSaved\nSpent\n")
    expect(choice).toBe("Choice\nEvery choice gives something up.\ncost = what you give up\nGood\nPrice\nTea\n2\nalert('no')\n")
  })

  it('drops links that are not web or mail', () => {
    const [section] = readMarkdown('[run](javascript:alert(1)) and [mail](mailto:a@b.c)', 'x').sections
    expect(section!.blocks[0]).toEqual({ type: 'paragraph', text: [{ text: 'run and ' }, { text: 'mail', href: 'mailto:a@b.c' }] })
  })

  it('cuts text without headings into parts', () => {
    const blocks: DocBlock[] = Array.from({ length: 130 }, (_, i) => ({ type: 'paragraph', text: [{ text: `Line ${i}` }] }))
    expect(sectionsOf(blocks, 'Notes').map((section) => section.title)).toEqual(['Notes, part 1', 'Notes, part 2', 'Notes, part 3'])
    expect(blockText({ type: 'rule' })).toBe('')
  })

  it('reads a file by its extension', async () => {
    const document = await readDocument(new TextEncoder().encode('# A\n\nb\n\n# C\n\nd'), 'notes.MD', 'Notes')
    expect(document.sections.map((section) => section.title)).toEqual(['A', 'C'])
    await expect(readDocument(new Uint8Array(), 'x.rtf', 'X')).rejects.toThrow(/\.rtf/)
  })
})
