import { useEffect } from 'react'
import { keyLabel, keysOn, SHORTCUTS } from '../shared/shortcuts.js'
import { frame } from './platform.js'

/**
 * Every keyboard shortcut on one card (⌘/ or Ctrl+/, or Keyboard shortcuts in
 * the sidebar), written the way this system writes them. Esc closes.
 */
export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="shortcuts-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="shortcuts" role="dialog" aria-label="Keyboard shortcuts">
        <header className="shortcuts-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="shortcuts-close" aria-label="Close" onClick={onClose}>
            Esc
          </button>
        </header>
        <div className="shortcuts-groups">
          {SHORTCUTS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3>{group.title}</h3>
              <dl>
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.id} className="shortcut">
                    <dt>{shortcut.label}</dt>
                    <dd>
                      <kbd>{keyLabel(frame, keysOn(frame, shortcut.keys))}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}
