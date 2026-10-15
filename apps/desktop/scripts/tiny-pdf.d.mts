/** A one-page PDF that says `text`, written by hand so checks need no fixtures. */
export function tinyPdf(text: string): string
/** A PDF with a page per string, and a contents list pointing at pages by number. */
export function bookPdf(pages: string[], chapters?: Array<{ title: string; page: number }>): string
