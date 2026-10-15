/** A small EPUB 3, one document per chapter. */
export function tinyEpub(title: string, chapters: ReadonlyArray<{ title: string; paragraphs: readonly string[] }>): Buffer
/** A Word file (.docx) of headings and paragraphs. */
export function tinyDocx(blocks: ReadonlyArray<{ heading: string } | { text: string }>): Buffer
/** A PowerPoint file (.pptx): a title, bullets and maybe speaker notes per slide. */
export function tinyPptx(slides: ReadonlyArray<{ title: string; bullets: readonly string[]; notes?: string }>): Buffer
