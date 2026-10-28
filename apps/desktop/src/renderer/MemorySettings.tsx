import { siteOf } from '@carrel/memory/sites'
import { useEffect, useRef, useState } from 'react'
import type { MemorySettingsView } from '../shared/memory-api.js'

const memory = window.carrel.memory

/**
 * Memory's settings: the reading trail's sites, the evening hour, and the
 * one-off ChatGPT import, and making pieces now. Changes save as you make them; Esc closes.
 */
export function MemorySettings({ onClose, importAsk }: { onClose: () => void; importAsk?: number }) {
  const [settings, setSettings] = useState<MemorySettingsView>()
  const [site, setSite] = useState('')
  const [imported, setImported] = useState<string>()
  const [made, setMade] = useState<string>()
  const [error, setError] = useState<string>()

  // The settings as you last changed them, so quick changes build on each other while saves are on their way.
  const latest = useRef<MemorySettingsView>(undefined)
  const saves = useRef(0)
  useEffect(() => {
    void memory.settings().then((read) => {
      latest.current ??= read
      setSettings(latest.current)
    })
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

  const save = (change: (now: MemorySettingsView) => Partial<MemorySettingsView>): void => {
    if (!latest.current) return
    const next = change(latest.current)
    latest.current = { ...latest.current, ...next }
    setSettings(latest.current)
    setError(undefined)
    // Main saves one at a time, in order, so the last change wins; the newest save shows what was kept ("x.com" for "https://www.x.com").
    const mine = ++saves.current
    memory.saveSettings(next).then(
      (saved) => {
        if (mine !== saves.current) return
        latest.current = saved
        setSettings(saved)
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    )
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
  const distillNow = (): void => {
    setMade('Making pieces…')
    setError(undefined)
    memory.distillNow().then(
      (result) => setMade(result.pieces > 0 ? `Made ${count(result.pieces, 'piece')} and drew ${count(result.lines, 'line')}.` : 'Nothing new to make pieces from.'),
      (reason: unknown) => {
        setMade(undefined)
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }
  useEffect(() => {
    if (importAsk) importChatGpt()
    // Once for each import asked for.
  }, [importAsk])

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
                  <button type="button" aria-label={`Stop keeping ${known}`} onClick={() => save((now) => ({ trail: now.trail.filter((other) => other !== known) }))}>
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
                // Kept as main keeps it ("x.com" for "https://www.x.com"), so a later change can't bring a raw address back.
                const added = siteOf(site)
                if (!added) {
                  setError('That is not a site. Try something like arxiv.org.')
                  return
                }
                save((now) => ({ trail: [...new Set([...now.trail, added])] }))
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
              <select aria-label="Evening hour" value={settings?.eveningHour ?? 21} onChange={(event) => {
                  const hour = Number(event.target.value)
                  save(() => ({ eveningHour: hour }))
                }}>
                {Array.from({ length: 24 }, (_unused, hour) => (
                  <option key={hour} value={hour}>
                    {`${String(hour).padStart(2, '0')}:00`}
                  </option>
                ))}
              </select>
            </label>
            <p className="memory-settings-note">Days missed while Carrel was closed are caught up when it opens.</p>
            <button type="button" className="outline-button" onClick={distillNow}>
              Make pieces now
            </button>
            {made && <p className="memory-settings-note" role="status">{made}</p>}
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
