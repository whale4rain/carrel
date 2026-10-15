// Which stored files are read as text, and what each format is called. Kept
// apart from documents.ts so the desk can ask without loading the readers.

/** Files read as reading documents (see documents.ts), by extension. */
export const DOCUMENT_EXTENSIONS = ['.md', '.markdown']

/** A file name's extension, lower-cased, with its dot: ".md". */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function isDocumentFile(name: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(extensionOf(name))
}

const FORMATS: Record<string, string> = { '.pdf': 'PDF', '.md': 'Markdown', '.markdown': 'Markdown' }

/** What a stored file's format is called: "PDF", "Markdown". */
export function formatLabel(name: string): string {
  return FORMATS[extensionOf(name)] ?? (extensionOf(name).slice(1).toUpperCase() || 'File')
}
