import { useEffect, useState } from 'react'
import type { ItemView, ThatView } from '../shared/workspace-api.js'

/** How a chip names its spot: a position, never a sentence. */
export function chipLabel(that: ThatView, item: ItemView | undefined): string {
  if (that.label) return item?.kind === 'video' ? `▶ ${that.label}` : that.label
  return item?.url ? new URL(item.url).hostname.replace(/^www\./, '') : 'that.'
}

/** Chips the tray shows: the newest. */
const TRAY = 8

/**
 * The tray: the *that.*s made on this desk, as chips, ready to be cited once
 * notes and the agent arrive. A chip opens its source; × only takes it off
 * the tray, the *that.* itself is kept in the project.
 */
export function ThatTray({
  thats,
  items,
  lost,
  onOpen,
  onRemove,
}: {
  thats: readonly ThatView[]
  items: ReadonlyMap<string, ItemView>
  /** *that.*s no longer found in their source: their chips show the saved copy. */
  lost: ReadonlySet<string>
  onOpen: (that: ThatView) => void
  onRemove: (that: ThatView) => void
}) {
  if (thats.length === 0) return null
  return (
    <div className="that-tray" aria-label="Pointing at" onPointerDown={(event) => event.stopPropagation()}>
      <span className="that-tray-label">pointing at</span>
      <ul>
        {thats.slice(-TRAY).map((that) => {
          const item = items.get(that.itemId)
          return (
            <li key={that.id}>
              <button type="button" className="that-chip" data-state={lost.has(that.id) ? 'saved' : undefined} title={tip(that, item)} onClick={() => onOpen(that)}>
                {chipLabel(that, item)}
                {lost.has(that.id) && ' · saved'}
              </button>
              <button type="button" className="that-remove" aria-label={`Take ${chipLabel(that, item)} off the tray`} onClick={() => onRemove(that)}>
                ×
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function tip(that: ThatView, item: ItemView | undefined): string {
  const title = item?.title ?? 'A source no longer in this project'
  return that.text ? `${title}\n“${that.text.length > 200 ? `${that.text.slice(0, 200)}…` : that.text}”` : title
}

/** What a *that.* said when it was made, shown when its source no longer has it. */
export function SavedThat({ that, item, onClose }: { that: ThatView; item: ItemView | undefined; onClose: () => void }) {
  const [image, setImage] = useState<string>()
  useEffect(() => {
    if (!that.image) return
    let url: string | undefined
    void window.carrel.workspace.thatImage(that.id).then((png) => {
      if (png) setImage((url = URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' }))))
    })
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [that])
  return (
    <div className="that-saved" role="dialog" aria-label="Saved copy" onPointerDown={(event) => event.stopPropagation()}>
      <header>
        <span className="that-chip" data-state="saved">
          {chipLabel(that, item)} · saved
        </span>
        <button type="button" className="that-remove" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <p className="that-saved-note">{item ? `${item.title} has changed; this is what it said.` : 'Its source is gone; this is what it said.'}</p>
      {that.text && <blockquote>{that.text}</blockquote>}
      {image && <img src={image} alt="The saved frame" />}
    </div>
  )
}
