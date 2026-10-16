import { useEffect, useRef } from 'react'
import type { ItemView } from '../shared/workspace-api.js'

/** Told to every sheet of a kit when one of them changes its store. */
const STORE_CHANGED = 'carrel:kit-store-changed'
const WRITES = new Set(['store.set', 'store.delete', 'store.restore'])

/**
 * A learning kit's sheet: its page in an iframe sandboxed with scripts only,
 * served from the kit's own origin with Margin's tokens put in. The page
 * can't reach Carrel, the network or another kit; what it may ask of the
 * project goes through the host API, checked in main. Answers go back with
 * target "*" because a sandboxed page's origin is opaque; only this frame's
 * window gets them.
 */
export function KitView({ item, onActivate }: { item: ItemView & { kit: NonNullable<ItemView['kit']> }; onActivate: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)

  // A click inside the page goes to the page, not the desk; the window losing
  // focus to this frame is how the desk knows the sheet was picked.
  useEffect(() => {
    const onBlur = (): void => {
      setTimeout(() => {
        if (document.activeElement === frame.current) onActivate()
      })
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  })

  // The page's host calls: only from this frame, answered to this frame alone.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const page = frame.current?.contentWindow
      if (!page || event.source !== page) return
      const call = event.data as { carrelKit?: unknown; id?: unknown; method?: unknown; args?: unknown }
      if (call?.carrelKit !== 1 || typeof call.id !== 'number' || typeof call.method !== 'string') return
      const answer = (reply: { value: unknown } | { error: string }): void => page.postMessage({ carrelKit: 1, id: call.id, ...reply }, '*')
      const args = Array.isArray(call.args) ? call.args : []
      window.carrel.workspace.kitCall(item.kit.name, call.method, args).then(
        (value) => {
          answer({ value })
          if (WRITES.has(call.method as string)) window.dispatchEvent(new CustomEvent(STORE_CHANGED, { detail: { kit: item.kit.name, collection: args[0] } }))
        },
        (reason: unknown) => answer({ error: reason instanceof Error ? reason.message : String(reason) }),
      )
    }
    const onChanged = (event: Event): void => {
      const { kit, collection } = (event as CustomEvent<{ kit: string; collection: unknown }>).detail
      if (kit === item.kit.name) frame.current?.contentWindow?.postMessage({ carrelKit: 1, event: 'store.changed', collection }, '*')
    }
    window.addEventListener('message', onMessage)
    window.addEventListener(STORE_CHANGED, onChanged)
    return () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener(STORE_CHANGED, onChanged)
    }
  }, [item.kit.name])

  return (
    <div className="kit-view">
      <iframe ref={frame} title={`${item.kit.title}: ${item.title}`} src={item.kit.url} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" />
    </div>
  )
}
