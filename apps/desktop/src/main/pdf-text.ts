import { readFile } from 'node:fs/promises'

/** Each page's text in a PDF, for search. pdf.js loads only when first needed. */
export async function pdfPages(path: string): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: false, verbosity: 0 }).promise
  try {
    const pages: string[] = []
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''))
      page.cleanup()
    }
    return pages
  } finally {
    await doc.destroy()
  }
}
