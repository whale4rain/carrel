import { kitOfHost, kitOrigin, kitPolicy, kitScript, MARGIN_PATH, withMargin, type KitShelf } from '@carrel/kit-host'
import { net, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DESK_ORIGIN } from './desk-origin.js'

/**
 * Serves each kit at its own origin, https://<kit>.kit.carrel.app: its pages
 * with Margin put in, its other files as they are, and Margin itself (tokens,
 * fonts, the host bridge) under /_margin/. Every response carries the kit's
 * content security policy, so a page can't reach the network or another
 * origin.
 */
export function kitResponder(shelf: KitShelf, marginDir: string): (request: Request) => Promise<Response> | undefined {
  return (request) => {
    const url = new URL(request.url)
    const kit = kitOfHost(url.hostname)
    if (!kit) return undefined
    return respond(shelf, marginDir, kit, decodeURIComponent(url.pathname.slice(1))).catch(() => notFound(kit))
  }
}

async function respond(shelf: KitShelf, marginDir: string, kit: string, path: string): Promise<Response> {
  const headers = { 'content-security-policy': kitPolicy(kit), 'x-content-type-options': 'nosniff' }
  if (path === `${MARGIN_PATH}kit.js`) return new Response(kitScript(DESK_ORIGIN), { headers: { ...headers, 'content-type': 'text/javascript; charset=utf-8' } })
  if (path.startsWith(MARGIN_PATH)) {
    const file = normalize(join(marginDir, path.slice(MARGIN_PATH.length)))
    if (!file.startsWith(marginDir.endsWith(sep) ? marginDir : marginDir + sep)) return notFound(kit)
    // Fonts load in CORS mode, and a sandboxed page's origin is opaque.
    return withHeaders(await net.fetch(pathToFileURL(file).href), { ...headers, 'access-control-allow-origin': '*' })
  }
  const file = await shelf.file(kit, path)
  if (!file) return notFound(kit)
  if (path.endsWith('.html')) return new Response(withMargin(await readFile(file, 'utf8')), { headers: { ...headers, 'content-type': 'text/html; charset=utf-8' } })
  return withHeaders(await net.fetch(pathToFileURL(file).href), headers)
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  if (!response.ok) return response
  const merged = new Headers(response.headers)
  for (const [name, value] of Object.entries(headers)) merged.set(name, value)
  return new Response(response.body, { status: response.status, headers: merged })
}

function notFound(kit: string): Response {
  return new Response('Not found', { status: 404, headers: { 'content-security-policy': kitPolicy(kit) } })
}

/**
 * A kit's page may only move within its own kit. Going anywhere else (the
 * web, or another kit) loads the page it was on again instead, so a page
 * can't carry what it knows out by navigating. (The web is already out of
 * reach: the desk's own policy allows frames only from YouTube and kits.)
 */
export function keepKitsHome(session: Session): void {
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'], types: ['subFrame'] }, (details, callback) => {
    const here = details.frame?.url ?? ''
    const kit = kitOfHost(hostOf(here))
    if (kit === undefined || originOf(details.url) === kitOrigin(kit)) callback({})
    else callback(originOf(here) === kitOrigin(kit) ? { redirectURL: here } : { cancel: true })
  })
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}
