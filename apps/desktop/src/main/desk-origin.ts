import { net, protocol, session } from 'electron'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The desk is served from an https origin rather than file://. Video embeds
 * such as YouTube's refuse a page without an http(s) origin, and their
 * postMessage API only talks to the origin they were given. Only this host
 * is intercepted; every other https request goes out as usual.
 */
export const DESK_HOST = 'desk.carrel.app'
export const DESK_ORIGIN = `https://${DESK_HOST}`

/** Serves the built renderer at DESK_ORIGIN from `root`. Call once, when the app is ready. */
export function serveDesk(root: string): void {
  protocol.handle('https', (request) => {
    const url = new URL(request.url)
    if (url.hostname !== DESK_HOST) return net.fetch(request, { bypassCustomProtocolHandlers: true })
    const path = normalize(join(root, decodeURIComponent(url.pathname)))
    if (path !== root && !path.startsWith(root.endsWith(sep) ? root : root + sep)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(path).href)
  })
  // Some embeds check the Referer as well as the origin parameter.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://*.youtube-nocookie.com/*', 'https://*.youtube.com/*'] }, (details, callback) => {
    details.requestHeaders.Referer ??= `${DESK_ORIGIN}/`
    callback({ requestHeaders: details.requestHeaders })
  })
}

/** The page for a window, with its frame. */
export function deskUrl(frame: string): string {
  return `${DESK_ORIGIN}/index.html?frame=${encodeURIComponent(frame)}`
}
