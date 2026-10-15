/** Only web and mail links are kept; anything else is just its words. */
export function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:' ? url.href : undefined
  } catch {
    return undefined
  }
}
