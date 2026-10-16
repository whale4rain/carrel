/**
 * How a kit's sheet is served. Each kit has its own origin,
 * https://<kit>.kit.carrel.app, and its pages load in an iframe sandboxed
 * with scripts only: no same-origin access (so no storage and no reach into
 * Carrel), no popups, no forms, no top navigation. The policy below keeps the
 * page to its own files: no network, no other origins.
 */

export const KIT_DOMAIN = 'kit.carrel.app'

/** The origin a kit's pages are served from. */
export function kitOrigin(name: string): string {
  return `https://${name}.${KIT_DOMAIN}`
}

/** The kit a host belongs to, if it is a kit's host. */
export function kitOfHost(host: string): string | undefined {
  const match = /^([a-z][a-z0-9-]{0,39})\.kit\.carrel\.app$/.exec(host)
  return match?.[1]
}

/** Margin's tokens, fonts and the host bridge, served beside every kit's own files. */
export const MARGIN_PATH = '_margin/'

/** The content security policy for every response from a kit's origin. */
export function kitPolicy(name: string): string {
  const self = kitOrigin(name)
  return [
    "default-src 'none'",
    `script-src ${self} 'unsafe-inline'`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:`,
    `font-src ${self}`,
    `media-src ${self} blob:`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
  ].join('; ')
}

/**
 * A kit's page with Margin put in: the tokens and fonts first, so the page's
 * own styles can use them, then the host bridge. Kit authors write plain
 * HTML and use var(--paper), var(--ink), var(--pencil) and the rest.
 */
export function withMargin(html: string): string {
  const tags = `<link rel="stylesheet" href="/${MARGIN_PATH}margin.css"><script src="/${MARGIN_PATH}kit.js"></script>`
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + tags + html.slice(head.index + head[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  const at = doctype ? doctype[0].length : 0
  return `${html.slice(0, at)}<head>${tags}</head>${html.slice(at)}`
}

/**
 * The host bridge every kit page gets as `window.kit`. For now it only says
 * which sheet it is; the store and the rest of the host API come next.
 */
export const KIT_SCRIPT = `(() => {
  const params = new URLSearchParams(location.search)
  const kit = Object.freeze({ sheet: params.get('sheet') || '' })
  Object.defineProperty(window, 'kit', { value: kit })
})()
`
