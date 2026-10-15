import { useEffect, useRef, useState } from 'react'
import type { AgentStatus, ThreadView, Turn, TurnCost, TurnStep } from '../shared/agent-api.js'
import { Markdown } from './Markdown.js'

const agent = window.carrel.agent

/**
 * The project's ongoing thread with the agent, docked on the right (⌘J).
 * Your turns sit right on paper-2; the agent's answers sit left in Literata,
 * each opened by one folded line of what it did and what it sent.
 */
export function AgentPanel({ project, onClose }: { project: string; onClose: () => void }) {
  const [status, setStatus] = useState<AgentStatus>()
  const [thread, setThread] = useState<ThreadView>({ turns: [], total: { bytes: 0, calls: 0 } })
  // A question on its way, and the answer as it arrives.
  const [asking, setAsking] = useState<{ text: string; steps: TurnStep[]; answer: string }>()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string>()
  const body = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let current = true
    void Promise.all([agent.status(), agent.thread()]).then(([known, turns]) => {
      if (!current) return
      setStatus(known)
      setThread(turns)
    })
    return () => {
      current = false
    }
  }, [project])

  useEffect(
    () =>
      agent.onLive((event) =>
        setAsking((now) => {
          if (!now) return now
          return event.type === 'text' ? { ...now, answer: event.text } : { ...now, steps: [...now.steps, event.step] }
        }),
      ),
    [],
  )

  // Keep the newest words in view.
  useEffect(() => {
    const element = body.current
    if (element) element.scrollTop = element.scrollHeight
  }, [thread.turns.length, asking?.answer, asking?.steps.length])

  useEffect(() => input.current?.focus(), [status?.ready])

  const send = (): void => {
    const text = draft.trim()
    if (!text || asking) return
    setDraft('')
    setError(undefined)
    setAsking({ text, steps: [], answer: '' })
    agent
      .ask(text)
      .then(() => agent.thread())
      .then(setThread, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setAsking(undefined))
  }

  const today = new Date().toDateString()
  const earlier = thread.turns.filter((turn) => new Date(turn.createdAt).toDateString() !== today)
  const recent = thread.turns.slice(earlier.length)
  const [unfolded, setUnfolded] = useState(false)
  const since = thread.turns[0] ? shortDate(thread.turns[0].createdAt) : undefined

  return (
    <aside className="agent-panel" aria-label="Project thread">
      <header className="agent-head">
        <span className="agent-seat" aria-hidden="true">
          a
        </span>
        <div className="agent-title">
          <b>Project thread</b>
          <span>
            {project}
            {since ? ` · ongoing since ${since}` : ''}
            {thread.total.calls > 0 ? ` · ${bytes(thread.total.bytes)} sent` : ''}
          </span>
        </div>
        <button type="button" className="agent-close" aria-label="Close the thread" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="agent-body" ref={body}>
        {thread.turns.length === 0 && !asking && (
          <p className="agent-empty">Ask about what you are reading. The agent searches this project&rsquo;s notes, sources and pages before it answers.</p>
        )}
        {earlier.length > 0 && (
          <button type="button" className="agent-day" onClick={() => setUnfolded((now) => !now)}>
            <i />
            {unfolded ? 'Earlier' : `Earlier · ${earlier.length} turns, folded`}
            <i />
          </button>
        )}
        {unfolded && earlier.map((turn) => <TurnView key={turn.id} turn={turn} />)}
        {recent.length > 0 && earlier.length > 0 && (
          <p className="agent-day">
            <i />
            Today
            <i />
          </p>
        )}
        {recent.map((turn) => (
          <TurnView key={turn.id} turn={turn} />
        ))}
        {asking && (
          <>
            <p className="agent-me">{asking.text}</p>
            <div className="agent-answer" data-live="">
              <Steps steps={asking.steps} cost={undefined} />
              {asking.answer ? <Markdown className="agent-text" text={asking.answer} /> : <p className="agent-thinking">Thinking…</p>}
            </div>
          </>
        )}
        {error && (
          <p className="agent-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className="agent-foot">
        {status && !status.ready ? (
          <KeyForm status={status} onSaved={setStatus} />
        ) : (
          <div className="agent-input">
            <textarea
              ref={input}
              rows={1}
              value={draft}
              placeholder="Ask anytime…"
              aria-label="Ask the agent"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  send()
                }
              }}
            />
            <button type="button" className="agent-send" aria-label="Send" disabled={!draft.trim() || asking !== undefined} onClick={send}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        )}
      </footer>
    </aside>
  )
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.by === 'user') return <p className="agent-me">{turn.text}</p>
  return (
    <div className="agent-answer">
      <Steps steps={turn.steps ?? []} cost={turn.cost} />
      {turn.error ? (
        <p className="agent-error">No answer: {turn.error}</p>
      ) : (
        <Markdown className="agent-text" text={turn.text} />
      )}
    </div>
  )
}

/** The folded line: what the agent did, and what it sent. Open it for each step. */
function Steps({ steps, cost }: { steps: readonly TurnStep[]; cost: TurnCost | undefined }) {
  const [open, setOpen] = useState(false)
  if (steps.length === 0 && !cost) return null
  const parts = [
    steps[0]?.summary,
    steps.length > 1 ? `${steps.length} steps` : undefined,
    cost && cost.calls > 0 ? `sent ${bytes(cost.bytes)}` : undefined,
  ].filter((part) => part !== undefined)
  return (
    <div className="agent-steps">
      <button type="button" aria-expanded={open} onClick={() => setOpen((now) => !now)}>
        {open ? '▾' : '▸'} {parts.join(' · ')}
      </button>
      {open && (
        <ul>
          {steps.map((step, at) => (
            <li key={at}>{step.summary}</li>
          ))}
          {cost && cost.calls > 0 && (
            <li>
              Sent {bytes(cost.bytes)} in {cost.calls} {cost.calls === 1 ? 'request' : 'requests'}
              {cost.promptTokens !== undefined ? ` · ${cost.promptTokens.toLocaleString()} tokens in, ${(cost.completionTokens ?? 0).toLocaleString()} out` : ''}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** Asks for a model key once; main keeps it with the system keychain. */
function KeyForm({ status, onSaved }: { status: AgentStatus; onSaved: (status: AgentStatus) => void }) {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string>()
  if (!status.canSave) {
    return <p className="agent-key-note">The agent needs a model key. This computer can&rsquo;t keep one safely, so set CARREL_LLM_API_KEY and restart Carrel.</p>
  }
  return (
    <form
      className="agent-key"
      onSubmit={(event) => {
        event.preventDefault()
        agent.saveKey(key).then(onSaved, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      }}
    >
      <p className="agent-key-note">
        The agent needs a model key ({status.model}). It is kept in your system keychain, and only sent to the model.
      </p>
      <div className="agent-input">
        <input type="password" value={key} placeholder="Paste a key" aria-label="Model key" autoComplete="off" onChange={(event) => setKey(event.target.value)} />
        <button type="submit" className="agent-save" disabled={key.trim().length === 0}>
          Save
        </button>
      </div>
      {error && <p className="agent-error">{error}</p>}
    </form>
  )
}

/** "14 KB", "1.2 MB". */
export function bytes(count: number): string {
  // A no-break space keeps the number with its unit.
  if (count < 1024) return `${count}\u00a0B`
  if (count < 1024 * 1024) return `${Math.round(count / 1024)}\u00a0KB`
  return `${(count / 1024 / 1024).toFixed(1)}\u00a0MB`
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
