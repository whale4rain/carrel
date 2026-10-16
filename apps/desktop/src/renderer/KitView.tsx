import { useEffect, useRef } from 'react'
import type { ItemView } from '../shared/workspace-api.js'

/**
 * A learning kit's sheet: its page in an iframe sandboxed with scripts only,
 * served from the kit's own origin with Margin's tokens put in. The page
 * can't reach Carrel, the network or another kit; what it may ask of the
 * project goes through the host API.
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

  return (
    <div className="kit-view">
      <iframe ref={frame} title={`${item.kit.title}: ${item.title}`} src={item.kit.url} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="" />
    </div>
  )
}
