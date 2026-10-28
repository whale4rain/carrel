import { useEffect, useRef, useState } from 'react'
import type { KeepChoice, KeepOffer } from '../shared/memory-api.js'
import './shell.css'
import './memory.css'

const memory = window.carrel.memory

/** The order Keep picks for you: what you most likely meant. */
const PREFERRED: readonly KeepChoice[] = ['selection', 'page', 'copied', 'screenshot']

/**
 * The Keep window (⌘⇧K / Ctrl+Shift+K from any app): one thing to keep, the
 * page in Carrel, words selected there, text you copied, or the screen, and
 * an optional line on why. Enter keeps it; Esc closes.
 */
export function KeepWindow() {
  const [offer, setOffer] = useState<KeepOffer>()
  const [choice, setChoice] = useState<KeepChoice>()
  const [reason, setReason] = useState('')
  const [state, setState] = useState<'choosing' | 'keeping' | 'kept'>('choosing')
  const [error, setError] = useState<string>()
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void memory.offer().then((found) => {
      setOffer(found)
      setChoice(PREFERRED.find((kind) => offered(found, kind)))
      field.current?.focus()
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') memory.closeKeep()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const keep = async (): Promise<void> => {
    if (!choice || state !== 'choosing') return
    setState('keeping')
    try {
      await memory.keep(choice, reason)
      setState('kept')
      setTimeout(() => memory.closeKeep(), 700)
    } catch (reasonWhy) {
      setError(reasonWhy instanceof Error ? reasonWhy.message : String(reasonWhy))
      setState('choosing')
    }
  }

  const options = offer ? PREFERRED.filter((kind) => offered(offer, kind)) : []

  return (
    <form
      className="keep"
      aria-label="Keep"
      onSubmit={(event) => {
        event.preventDefault()
        void keep()
      }}
    >
      <h1 className="keep-title">Keep</h1>
      {offer && options.length === 0 && <p className="keep-empty">Nothing to keep yet. Open a page in Carrel, copy some text, or allow Carrel to take screenshots.</p>}
      <div className="keep-options" role="radiogroup" aria-label="What to keep">
        {options.map((kind) => (
          <label key={kind} className="keep-option" data-kind={kind} aria-checked={choice === kind}>
            <input type="radio" name="keep" value={kind} checked={choice === kind} onChange={() => setChoice(kind)} />
            <span className="keep-option-kind">{LABELS[kind]}</span>
            {kind === 'screenshot' && offer?.screenshot ? <img className="keep-shot" src={offer.screenshot} alt="Your screen" /> : <span className="keep-option-text">{describe(offer!, kind)}</span>}
          </label>
        ))}
      </div>
      <input ref={field} className="keep-reason" aria-label="Why keep it" placeholder="Why keep it? (optional)" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      {error && <p className="keep-error">{error}</p>}
      <div className="keep-actions">
        <span className="keep-hint">Kept on this computer, in your Memory folder.</span>
        <button type="button" className="outline-button" onClick={() => memory.closeKeep()}>
          Cancel
        </button>
        <button type="submit" className="ink-button" disabled={!choice || state !== 'choosing'}>
          {state === 'kept' ? 'Kept' : 'Keep'}
        </button>
      </div>
    </form>
  )
}

const LABELS: Record<KeepChoice, string> = { selection: 'Selected words', page: 'This page', copied: 'Copied text', screenshot: 'Screenshot' }

function offered(offer: KeepOffer, kind: KeepChoice): boolean {
  if (kind === 'page') return offer.page !== undefined
  if (kind === 'selection') return offer.selection !== undefined
  if (kind === 'copied') return offer.copied !== undefined
  return offer.screenshot !== undefined
}

function describe(offer: KeepOffer, kind: KeepChoice): string {
  if (kind === 'page') return offer.page?.title || offer.page?.url || ''
  if (kind === 'selection') return `“${clip(offer.selection ?? '')}”`
  if (kind === 'copied') return `“${clip(offer.copied ?? '')}”`
  return ''
}

function clip(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 140 ? `${line.slice(0, 139)}…` : line
}
