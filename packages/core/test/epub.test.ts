import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readDocument, sectionTexts } from '../src/documents.js'
import { htmlToBlocks } from '../src/html-blocks.js'

const page = (body: string): string => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>x</title><style>p { color: red }</style></head><body>${body}</body></html>`

function epub(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])))
}

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Walden</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="Text/one%20economy.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="Text/two.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="Text/notes.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="cover"/><itemref idref="c1"/><itemref idref="c2"/><itemref idref="notes" linear="no"/></spine>
</package>`

const BOOK = {
  'mimetype': 'application/epub+zip',
  'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  'OEBPS/content.opf': OPF,
  'OEBPS/nav.xhtml': page(`<nav epub:type="toc"><ol><li><a href="Text/one%20economy.xhtml">I. Economy</a></li><li><a href="Text/one%20economy.xhtml#part2">Economy, later</a></li></ol></nav>`),
  'OEBPS/Text/cover.xhtml': page(`<div><img src="../Images/cover.jpg" alt=""/></div>`),
  'OEBPS/Text/one economy.xhtml': page(`<h1>Economy</h1>
    <p>When I wrote the following pages, or rather the bulk of them, I lived <em>alone</em>, in the woods.</p>
    <p class="x">I have <a href="https://example.com/walden">travelled</a> a good deal in <a href="javascript:alert(1)">Concord</a>;&#160;and <b>everywhere</b>.</p>
    <script>alert('no')</script>`),
  'OEBPS/Text/two.xhtml': page(`<section><h2>Where I Lived</h2><div>At a certain season of our life<br/>we are accustomed.</div>
    <ul><li>Hollowell farm</li><li><p>Baker Farm</p></li></ul>
    <table><tr><th>Item</th><th>Cost</th></tr><tr><td>Boards</td><td>$8.03½</td></tr></table></section>`),
  'OEBPS/Text/notes.xhtml': page(`<p>Endnotes</p>`),
}

describe('reading an EPUB', () => {
  it('reads the spine in order, named by the contents, skipping wordless and non-linear documents', async () => {
    const { sections } = await readDocument(epub(BOOK), 'Walden.epub', 'Walden')
    expect(sections.map((section) => section.title)).toEqual(['I. Economy', 'Where I Lived'])
  })

  it('keeps words, marks and safe links, and drops scripts and styles', async () => {
    const document = await readDocument(epub(BOOK), 'Walden.epub', 'Walden')
    const texts = sectionTexts(document)
    expect(texts[0]).toBe(
      'Economy\nWhen I wrote the following pages, or rather the bulk of them, I lived alone, in the woods.\nI have travelled a good deal in Concord; and everywhere.\n',
    )
    expect(texts[1]).toBe('Where I Lived\nAt a certain season of our life we are accustomed.\nHollowell farm\nBaker Farm\nItem\nCost\nBoards\n$8.03½\n')
    const second = document.sections[0]!.blocks[2]!
    expect(second).toEqual({
      type: 'paragraph',
      text: [{ text: 'I have ' }, { text: 'travelled', href: 'https://example.com/walden' }, { text: ' a good deal in Concord; and ' }, { text: 'everywhere', bold: true }, { text: '.' }],
    })
  })

  it('names a section by its heading when the contents leave it out', async () => {
    const book = { ...BOOK, 'OEBPS/nav.xhtml': page('<nav epub:type="toc"><ol></ol></nav>') }
    const { sections } = await readDocument(epub(book), 'Walden.epub', 'Walden')
    expect(sections.map((section) => section.title)).toEqual(['Economy', 'Where I Lived'])
  })

  it('says so when a file is not an EPUB it can read', async () => {
    await expect(readDocument(epub({ 'mimetype': 'application/epub+zip' }), 'Broken.epub', 'Broken')).rejects.toThrow(/no package file/)
  })
})

describe('HTML as blocks', () => {
  it('reads nested quotes, code and stray text', () => {
    expect(htmlToBlocks('<body>Loose <i>words</i><blockquote><p>Quoted</p></blockquote><pre>a  b\n c</pre><hr></body>')).toEqual([
      { type: 'paragraph', text: [{ text: 'Loose ' }, { text: 'words', italic: true }] },
      { type: 'quote', blocks: [{ type: 'paragraph', text: [{ text: 'Quoted' }] }] },
      { type: 'code', text: 'a  b\n c' },
      { type: 'rule' },
    ])
  })
})
