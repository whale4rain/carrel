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
 * The host bridge every kit page gets as `window.kit`. Each call goes to the
 * desk by postMessage and comes back as a promise; the desk checks it against
 * the kit's manifest and what the person allowed before anything happens.
 */
export function kitScript(deskOrigin: string): string {
  return `(() => {
  const desk = ${JSON.stringify(deskOrigin)}
  const sheet = new URLSearchParams(location.search).get('sheet') || ''
  const waiting = new Map()
  const changes = new Set()
  let last = 0
  const call = (method, ...args) =>
    new Promise((resolve, reject) => {
      const id = ++last
      waiting.set(id, { resolve, reject })
      parent.postMessage({ carrelKit: 1, id, method, args }, desk)
    })
  addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== desk) return
    const data = event.data
    if (!data || data.carrelKit !== 1) return
    if (data.event === 'store.changed') {
      for (const listener of changes) {
        try {
          listener(data.collection)
        } catch (error) {
          console.error(error)
        }
      }
      return
    }
    if (!waiting.has(data.id)) return
    const { resolve, reject } = waiting.get(data.id)
    waiting.delete(data.id)
    if ('error' in data) reject(new Error(data.error))
    else resolve(data.value)
  })
  const store = Object.freeze({
    info: (collection) => call('store.info', collection),
    get: (collection, id) => call('store.get', collection, id),
    set: (collection, id, value) => call('store.set', collection, id, value),
    delete: (collection, id) => call('store.delete', collection, id),
    restore: (collection, id) => call('store.restore', collection, id),
    query: (collection, options) => call('store.query', collection, options),
    /** Calls back when any sheet of this kit changes the store (with the collection's name); returns a stop function. */
    onChange: (listener) => {
      changes.add(listener)
      return () => changes.delete(listener)
    },
  })
  const kit = Object.freeze({
    sheet,
    store,
    read: (what) => call('read', what),
    agent: Object.freeze({ ask: (prompt) => call('agent.ask', prompt) }),
    srs: Object.freeze({ schedule: (item, result) => call('srs.schedule', item, result) }),
    speak: (words) => call('speak', words),
  })
  Object.defineProperty(window, 'kit', { value: kit })
})()
`
}
