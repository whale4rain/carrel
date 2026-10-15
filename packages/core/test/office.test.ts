import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { readDocument, sectionTexts } from '../src/documents.js'

const zip = (files: Record<string, string>): Uint8Array => zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])))
const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships'

describe('reading a Word file', () => {
  const run = (text: string, marks = ''): string => `<w:r>${marks ? `<w:rPr>${marks}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`
  const heading = (text: string): string => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run(text)}</w:p>`
  const docx = (body: string): Uint8Array =>
    zip({
      '[Content_Types].xml':
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${RELS}/officeDocument" Target="word/document.xml"/></Relationships>`,
      'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    })

  it('cuts sections at the main headings and keeps bold, italic and tables', async () => {
    const document = await readDocument(
      docx(
        `${heading('Supply')}<w:p>${run('Price ')}${run('rises', '<w:b/>')}${run(' when ')}${run('demand', '<w:i/>')}${run(' grows.')}</w:p>` +
          `${heading('Demand')}<w:tbl><w:tr><w:tc><w:p>${run('Good')}</w:p></w:tc><w:tc><w:p>${run('Price')}</w:p></w:tc></w:tr><w:tr><w:tc><w:p>${run('Tea')}</w:p></w:tc><w:tc><w:p>${run('2')}</w:p></w:tc></w:tr></w:tbl>`,
      ),
      'Economics.docx',
      'Economics',
    )
    expect(document.sections.map((section) => section.title)).toEqual(['Supply', 'Demand'])
    expect(document.sections[0]!.blocks[1]).toEqual({
      type: 'paragraph',
      text: [{ text: 'Price ' }, { text: 'rises', bold: true }, { text: ' when ' }, { text: 'demand', italic: true }, { text: ' grows.' }],
    })
    expect(sectionTexts(document)[1]).toBe('Demand\nGood\nPrice\nTea\n2\n')
  })

  it('says so when there is no text', async () => {
    await expect(readDocument(docx(''), 'Empty.docx', 'Empty')).rejects.toThrow(/no text/)
  })
})

describe('reading a PowerPoint file', () => {
  const NS =
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  const box = (placeholder: string, paragraphs: string[]): string =>
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="x"/><p:cNvSpPr/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paragraphs.map((runs) => `<a:p>${runs}</a:p>`).join('')}</p:txBody></p:sp>`
  const run = (text: string, properties = '<a:rPr lang="en-US"/>'): string => `<a:r>${properties}<a:t>${text}</a:t></a:r>`
  const slide = (tree: string): string => `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree>${tree}</p:spTree></p:cSld></p:sld>`

  const deck = zip({
    // Slides go in the order the presentation lists them, not by file name.
    'ppt/presentation.xml': `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${RELS}/slide" Target="slides/slide2.xml"/><Relationship Id="rId2" Type="${RELS}/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="${RELS}/slide" Target="slides/slide3.xml"/></Relationships>`,
    'ppt/slides/slide1.xml': slide(
      box('<p:ph type="ctrTitle"/>', [run('Opportunity cost')]) +
        box('<p:ph type="subTitle" idx="1"/>', [run('What you give up')]) +
        box('', [run('See ') + run('the notes', '<a:rPr><a:hlinkClick r:id="rId7"/></a:rPr>') + run(' later.', '<a:rPr b="1"/>')]),
    ),
    'ppt/slides/_rels/slide1.xml.rels': `<?xml version="1.0"?><Relationships xmlns="${PACKAGE}"><Relationship Id="rId7" Type="${RELS}/hyperlink" Target="https://example.com/notes" TargetMode="External"/><Relationship Id="rId8" Type="${RELS}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
    'ppt/notesSlides/notesSlide1.xml': `<?xml version="1.0"?><p:notes ${NS}><p:cSld><p:spTree>${box('<p:ph type="sldImg"/>', [])}${box('<p:ph type="body" idx="1"/>', [run('Start with a story.')])}</p:spTree></p:cSld></p:notes>`,
    'ppt/slides/slide2.xml': slide(
      `<p:grpSp>${box('<p:ph type="title"/>', [run('Two choices')])}</p:grpSp>` +
        `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p>${run('Tea')}</a:p></a:txBody></a:tc><a:tc><a:txBody><a:p>${run('2')}</a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
    ),
    'ppt/slides/slide3.xml': slide(''),
  })

  it('reads one section per slide, in order, named by its title', async () => {
    const { sections } = await readDocument(deck, 'Economics.pptx', 'Economics')
    expect(sections.map((section) => section.title)).toEqual(['Opportunity cost', 'Two choices', 'Slide 3'])
  })

  it('keeps the words, links, tables and speaker notes', async () => {
    const document = await readDocument(deck, 'Economics.pptx', 'Economics')
    expect(sectionTexts(document)).toEqual([
      'Opportunity cost\nWhat you give up\nSee the notes later.\nSpeaker notes\nStart with a story.\n',
      'Two choices\nTea\n2\n',
      'This slide has no text.\n',
    ])
    expect(document.sections[0]!.blocks[2]).toEqual({
      type: 'paragraph',
      text: [{ text: 'See ' }, { text: 'the notes', href: 'https://example.com/notes' }, { text: ' later.', bold: true }],
    })
  })
})
