// Sites on the reading trail. Pure, so the renderer can use them as `@carrel/memory/sites`.

/** A site as the trail keeps it: its host, lower-cased, without "www.". "https://www.X.com/home" is "x.com". */
export function siteOf(text: string): string | undefined {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed) return undefined
  let host: string
  try {
    host = new URL(/^[a-z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`).hostname
  } catch {
    return undefined
  }
  host = host.replace(/^www\./, '')
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : undefined
}

/** Whether a page is on one of the trail's sites (a subdomain counts). Only http and https pages are read. */
export function onTrail(url: string, sites: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  return sites.some((site) => host === site || host.endsWith(`.${site}`))
}

/** A page's address as the trail keys it: without its #fragment, so scrolling to a heading isn't a new visit. */
export function visitKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}
