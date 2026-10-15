/** A one-page PDF that says `text`, written by hand so the check needs no fixtures. */
export function tinyPdf(text) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = pdf.length
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const at of offsets) pdf += `${String(at).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

/**
 * A PDF with a page per string in `pages`, and a contents list (outline) whose
 * entries point at pages by number (1 is the first).
 */
export function bookPdf(pages, chapters = []) {
  const objects = []
  const add = (body) => objects.push(body) // its number is objects.length
  add(null) // 1: catalog, filled in below
  add(null) // 2: pages
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') // 3
  const pageRefs = pages.map((text) => {
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    const contents = objects.length
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contents} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`)
    return objects.length
  })
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pages.length} >>`
  let catalog = '<< /Type /Catalog /Pages 2 0 R >>'
  if (chapters.length > 0) {
    const root = objects.length + 1
    const first = root + 1
    add(null)
    chapters.forEach((chapter, i) => {
      const self = first + i
      const links = [i > 0 ? `/Prev ${self - 1} 0 R` : '', i < chapters.length - 1 ? `/Next ${self + 1} 0 R` : ''].join(' ')
      add(`<< /Title (${chapter.title}) /Parent ${root} 0 R ${links} /Dest [${pageRefs[chapter.page - 1]} 0 R /XYZ 0 792 0] >>`)
    })
    objects[root - 1] = `<< /Type /Outlines /First ${first} 0 R /Last ${first + chapters.length - 1} 0 R /Count ${chapters.length} >>`
    catalog = `<< /Type /Catalog /Pages 2 0 R /Outlines ${root} 0 R >>`
  }
  objects[0] = catalog
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = pdf.length
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const at of offsets) pdf += `${String(at).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}
