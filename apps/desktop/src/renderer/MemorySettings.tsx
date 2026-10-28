import { useEffect, useState } from 'react'
import type { MemorySettingsView } from '../shared/memory-api.js'

const memory = window.carrel.memory

/**
 * Memory's settings: the reading trail's sites, the evening hour, and the
 * one-off ChatGPT import. Changes save as you make them; Esc closes.
 */
export function MemorySettings({ onClose, importNow = false }: { onClose: () => void; importNow?: boolean }) {
  const [settings, setSettings] = useState<MemorySettingsView>()
  const [site, setSite] = useState('')
  const [imported, setImported] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    void memory.settings().then(setSettings)
  }, [])
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

  const save = (next: Partial<MemorySettingsView>): void => {
    setError(undefined)
    void memory.saveSettings(next).then(setSettings, (reason: unknown) => setError(String(reason)))
  }
  const importChatGpt = (): void => {
    setImported('Reading the export…')
    setError(undefined)
    memory.importChatGpt().then(
      (result) => {
        if (!result) setImported(undefined)
        else setImported(result.kept > 0 ? `Kept ${count(result.kept, 'day')} of chats from ${count(result.conversations, 'conversation')}.` : `The ${count(result.conversations, 'conversation')} ${result.conversations === 1 ? 'was' : 'were'} kept before.`)
      },
      (reason: unknown) => {
        setImported(undefined)
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }
  useEffect(() => {
    if (importNow) importChatGpt()
    // Only when opened for an import.
  }, [])

  return (
    <div
      className="shortcuts-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="memory-settings" role="dialog" aria-label="Reading trail and memory">
        <header className="shortcuts-head">
          <h2>Reading trail and memory</h2>
          <button type="button" className="shortcuts-close" aria-label="Close" onClick={onClose}>
            Esc
          </button>
        </header>
        <div className="memory-settings-body">
          <section aria-label="Reading trail">
            <h3>Reading trail</h3>
            <p className="memory-settings-note">Pages you open in Carrel on these sites are kept as you read them, so you can find them again without saving. Off until you add a site.</p>
            <ul className="trail-sites">
              {settings?.trail.map((known) => (
                <li key={known}>
                  <span>{known}</span>
                  <button type="button" aria-label={`Stop keeping ${known}`} onClick={() => save({ trail: settings.trail.filter((other) => other !== known) })}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="trail-add"
              onSubmit={(event) => {
                event.preventDefault()
                if (!settings || !site.trim()) return
                save({ trail: [...settings.trail, site.trim()] })
                setSite('')
              }}
            >
              <input aria-label="Add a site" placeholder="arxiv.org, x.com, a blog…" value={site} onChange={(event) => setSite(event.target.value)} />
              <button type="submit" className="outline-button small" disabled={!site.trim()}>
                Add site
              </button>
            </form>
          </section>
          <section aria-label="Evening">
            <h3>Each evening</h3>
            <label className="memory-settings-row">
              The day is turned into pieces at
              <select aria-label="Evening hour" value={settings?.eveningHour ?? 21} onChange={(event) => save({ eveningHour: Number(event.target.value) })}>
                {Array.from({ length: 24 }, (_unused, hour) => (
                  <option key={hour} value={hour}>
                    {`${String(hour).padStart(2, '0')}:00`}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section aria-label="Import">
            <h3>Chats from elsewhere</h3>
            <p className="memory-settings-note">Your tnega and Carrel chats are kept on their own. For ChatGPT, export your data (Settings, Data controls, Export) and choose the .zip once.</p>
            <button type="button" className="outline-button" onClick={importChatGpt}>
              Import ChatGPT export…
            </button>
            {imported && <p className="memory-settings-note" role="status">{imported}</p>}
          </section>
          {error && <p className="keep-error">{error}</p>}
        </div>
      </section>
    </div>
  )
}

function count(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
