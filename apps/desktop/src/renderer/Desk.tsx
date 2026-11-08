import { useState } from 'react'
import type { Frame } from '../shared/frame.js'
import { shortcutLabel } from '../shared/shortcuts.js'
import { projectNameFrom } from './first-run.js'

/**
 * The first run, before there is any project: the agent asks what you are
 * learning, and your sentence names the project (you can change the name).
 */
export function FirstRun({ frame, onCreate, onImport, onMap }: { frame: Frame; onCreate(name: string): Promise<void>; onImport(): void; onMap(): void }) {
  const [about, setAbout] = useState('')
  // The name follows your sentence until you change it yourself.
  const [named, setNamed] = useState<string>()
  const name = named ?? projectNameFrom(about)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const create = async (event: { preventDefault(): void }): Promise<void> => {
    event.preventDefault()
    if (busy || !name.trim()) return
    setBusy(true)
    try {
      await onCreate(name.trim())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }

  return (
    <main className="desk-mat first-run-mat" aria-label="Desk">
      <section className="first-run" aria-label="Getting started">
        <div className="first-run-head">
          <span className="agent-seat first-run-seat" aria-hidden>
            a
          </span>
          <h2 className="welcome-title">
            What are you learning?
          </h2>
        </div>
        <p className="first-run-body">
          Carrel keeps what you read and ask each day and draws lines between days, so it adds up. Tell me in a sentence and I’ll set up a place for it: a project, with a first desk for your books, videos and pages. It’s a folder in{' '}
          <code>~/Carrel</code>, so your notes stay yours.
        </p>
        <form className="first-run-form" onSubmit={(event) => void create(event)}>
          <textarea
            className="first-run-about"
            aria-label="What are you learning?"
            placeholder="Economics, from Mankiw’s Principles and the MIT lectures"
            rows={2}
            value={about}
            autoFocus
            onChange={(event) => {
              setAbout(event.target.value)
              setError(undefined)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) void create(event)
            }}
          />
          <div className="first-run-name">
            <span className="first-run-label">Your project</span>
            <input
              aria-label="Project name"
              placeholder="Learn economics"
              value={name}
              spellCheck={false}
              onChange={(event) => {
                setNamed(event.target.value)
                setError(undefined)
              }}
            />
            <button type="submit" className="ink-button" disabled={busy || name.trim() === ''}>
              Create project
            </button>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </form>
        <div className="agent-suggest" aria-label="Other ways in">
          <button type="button" className="agent-suggestion" onClick={onImport}>
            Import my ChatGPT history
          </button>
          <button type="button" className="agent-suggestion" onClick={onMap}>
            Look at the Map
          </button>
        </div>
        <ul className="agent-can first-run-next" aria-label="What happens next">
          <li>
            <b>A first desk</b> to lay out books, papers, videos and web pages, and write notes beside them
          </li>
          <li>
            <b>Then the Map fills in</b> each evening, with the day’s pieces and lines to earlier days
          </li>
          <li>
            <b>Ask me from anywhere</b> with {shortcutLabel(frame, 'agent')}; I see what you see
          </li>
          <li>
            <b>Keep from any app</b> with {shortcutLabel(frame, 'keep')}: a page, a selection or a screenshot
          </li>
        </ul>
      </section>
    </main>
  )
}
