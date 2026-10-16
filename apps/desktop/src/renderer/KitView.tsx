import { useEffect, useRef } from 'react'
import type { ItemView } from '../shared/workspace-api.js'

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
      window.carrel.workspace.kitCall(item.kit.name, call.method, Array.isArray(call.args) ? call.args : []).then(
        (value) => answer({ value }),
        (reason: unknown) => answer({ error: reason instanceof Error ? reason.message : String(reason) }),
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [item.kit.name])

  return (
    <div className="kit-view">
      <iframe ref={frame} title={`${item.kit.title}: ${item.title}`} src={item.kit.url} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" />
    </div>
  )
}
