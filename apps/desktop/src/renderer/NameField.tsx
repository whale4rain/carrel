import { useState, type FormEvent } from 'react'

interface Props {
  label: string
  placeholder: string
  submit: string
  /** Throws with a message to show when the name is refused. */
  onSubmit(name: string): Promise<void>
  onCancel?(): void
  /** `inline` sits in a sidebar row; `form` stands alone with an ink button. */
  variant: 'inline' | 'form'
}

/** A name, typed and confirmed with Enter (or the button); Esc cancels. */
export function NameField({ label, placeholder, submit, onSubmit, onCancel, variant }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const send = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await onSubmit(name.trim())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }

  return (
    <form className={`name-field ${variant}`} onSubmit={(event) => void send(event)}>
      <input
        aria-label={label}
        placeholder={placeholder}
        value={name}
        autoFocus
        spellCheck={false}
        onChange={(event) => {
          setName(event.target.value)
          setError(undefined)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel?.()
        }}
        onBlur={() => {
          if (variant === 'inline' && name.trim() === '') onCancel?.()
        }}
      />
      {variant === 'form' && (
        <button type="submit" className="ink-button" disabled={busy || name.trim() === ''}>
          {submit}
        </button>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
