/** A small EPUB 3, one document per chapter, as an uncompressed zip. */
export function tinyEpub(title: string, chapters: ReadonlyArray<{ title: string; paragraphs: readonly string[] }>): Buffer
