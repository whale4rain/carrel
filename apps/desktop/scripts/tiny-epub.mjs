/**
 * A small EPUB 3 with one document per chapter, written by hand (an
 * uncompressed zip) so the tests need no fixtures. `chapters` are
 * { title, paragraphs } in reading order.
 */
export function tinyEpub(title, chapters) {
  const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const page = (body) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${escape(title)}</title></head><body>${body}</body></html>`
  const files = [
    ['mimetype', 'application/epub+zip'],
    [
      'META-INF/container.xml',
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ],
    [
      'OEBPS/content.opf',
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escape(title)}</dc:title></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters
        .map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
        .join('')}</manifest><spine>${chapters.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`,
    ],
    ['OEBPS/nav.xhtml', page(`<nav epub:type="toc"><ol>${chapters.map((chapter, i) => `<li><a href="c${i + 1}.xhtml">${escape(chapter.title)}</a></li>`).join('')}</ol></nav>`)],
    ...chapters.map((chapter, i) => [`OEBPS/c${i + 1}.xhtml`, page(`<h1>${escape(chapter.title)}</h1>${chapter.paragraphs.map((words) => `<p>${escape(words)}</p>`).join('')}`)]),
  ]
  return storedZip(files.map(([name, text]) => [name, Buffer.from(text, 'utf8')]))
}

/** A zip with every file stored as it is. */
function storedZip(files) {
  const parts = []
  const central = []
  let offset = 0
  for (const [name, data] of files) {
    const path = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(path.length, 26)
    parts.push(local, path, data)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(data.length, 20)
    entry.writeUInt32LE(data.length, 24)
    entry.writeUInt16LE(path.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, path)
    offset += local.length + path.length + data.length
  }
  const size = central.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, end])
}

function crc32(data) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
