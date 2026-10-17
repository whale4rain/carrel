import { useEffect, useRef, useState, type ReactNode } from 'react'
import { PROJECT_THREAD, type AgentStatus, type AskContext, type ProposalView, type SideThread, type ThreadView, type Turn, type TurnCost, type TurnStep } from '../shared/agent-api.js'
import type { ItemView, ThatView } from '../shared/workspace-api.js'
import { Markdown } from './Markdown.js'
import { ProposalCard } from './ProposalCard.js'
import { THAT_DRAG } from './ThatTray.js'

const agent = window.carrel.agent

/** The panel's thread before a side thread's first question names it. */
export const NEW_SIDE = 'new'

/**
 * The project's ongoing thread with the agent, docked on the right (⌘J), or
 * one of its side threads (the Threads menu in the header).
 * Your turns sit right on paper-2; the agent's answers sit left in Literata,
 * each opened by one folded line of what it did and what it sent.
 */
export function AgentPanel({
  project,
  threadId,
  sides,
  onThread,
  pointing,
  context,
  onUnpoint,
  onAsked,
  onOpenThat,
  onOpenItem,
  onAccepted,
  onAddToNote,
  focusTurn,
  prompt,
  onClose,
}: {
  project: string
  /** The project thread, a side thread's id, or NEW_SIDE. */
  threadId: string
  sides: readonly SideThread[]
  /** Show another thread: the project thread, a side thread, or a new one. Its first answer gives a new side thread its id. */
  onThread: (id: string) => void
  /** The *that.*s you are pointing at; they go with your next question. */
  pointing: readonly ThatView[]
  context: () => AskContext
  onUnpoint: (id: string) => void
  onAsked: () => void
  /** A chip in the thread was clicked. */
  onOpenThat: (id: string) => void
  /** Open a note or source an accepted proposal made. */
  onOpenItem: (id: string) => void
  /** A proposal was accepted: the note or source it made or changed. */
  onAccepted: (item: ItemView) => void
  /** Add a turn to the note selected on the desk, or to a new note. */
  onAddToNote: (turnId: string, thread: string) => Promise<ItemView>
  /** A turn to bring into view, from a chip that points at it. */
  focusTurn?: { id: string; nonce: number } | undefined
  /** Words for the composer from a right-click on the desk: sent at once, or left for you to finish. */
  prompt?: { text: string; send: boolean; nonce: number } | undefined
  onClose: () => void
}) {
  const [status, setStatus] = useState<AgentStatus>()
  const [thread, setThread] = useState<ThreadView>({ turns: [], total: { bytes: 0, calls: 0 } })
  // A question on its way, and the answer as it arrives.
  const [asking, setAsking] = useState<{ text: string; points: string[]; steps: TurnStep[]; answer: string }>()
  // Labels of the project's that.s, for the chips your questions pointed at.
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map())
  const [proposals, setProposals] = useState<ProposalView[]>([])
  // The that.s made on turns, by turn.
  const [pointed, setPointed] = useState<ReadonlyMap<string, ThatView>>(new Map())
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState(false)
  // A new side thread's id, once its first question has named it.
  const [started, setStarted] = useState<string>()
  const here = started ?? threadId
  const side = sides.find((candidate) => candidate.id === threadId)
  const [error, setError] = useState<string>()
  const body = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let current = true
    const turns = threadId === NEW_SIDE ? Promise.resolve({ turns: [], total: { bytes: 0, calls: 0 } }) : agent.thread(threadId)
    void Promise.all([agent.status(), turns, window.carrel.workspace.thats(), agent.proposals()]).then(([known, kept, thats, proposed]) => {
      if (!current) return
      setStatus(known)
      setThread(kept)
      setProposals(proposed)
      setLabels(new Map(thats.map((that) => [that.id, that.label])))
      setPointed(new Map(thats.flatMap((that) => (that.itemId === `thread:${threadId}` && turnOf(that) ? [[turnOf(that)!, that] as const] : []))))
    })
    return () => {
      current = false
    }
  }, [project, threadId])

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

  // A learning kit asked the agent: its turns land in the project thread.
  useEffect(
    () =>
      agent.onTurns(() => {
        if (threadId === PROJECT_THREAD) void agent.thread(threadId).then(setThread)
      }),
    [threadId],
  )

  useEffect(() => agent.onProposal((proposal) => setProposals((known) => [...known.filter((other) => other.id !== proposal.id), proposal])), [])

  // Keep the newest words in view.
  useEffect(() => {
    const element = body.current
    if (element) element.scrollTop = element.scrollHeight
  }, [thread.turns.length, asking?.answer, asking?.steps.length, proposals.length])

  useEffect(() => input.current?.focus(), [status?.ready])

  const send = (words = draft): void => {
    const text = words.trim()
    if (!text || asking) return
    const asked = context()
    setDraft('')
    setError(undefined)
    setLabels((known) => new Map([...known, ...pointing.map((that) => [that.id, that.label] as const)]))
    setAsking({ text, points: asked.points, steps: [], answer: '' })
    onAsked()
    // A new side thread is named by its first question.
    const thread = here === NEW_SIDE ? agent.startSide(text).then((made) => (setStarted(made.id), made.id)) : Promise.resolve(here)
    void thread
      .then(async (id) => {
        await agent.ask(text, asked, id)
        if (here === NEW_SIDE) onThread(id)
        else setThread(await agent.thread(id))
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setAsking(undefined))
  }

  // A right-click on the desk asks now, or starts a question for you to finish.
  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => {
    if (!prompt) return
    if (prompt.send && !asking) sendRef.current(prompt.text)
    else {
      setDraft(prompt.text)
      requestAnimationFrame(() => {
        const field = input.current
        if (!field) return
        field.focus()
        field.setSelectionRange(field.value.length, field.value.length)
      })
    }
    // Only a new prompt; what is being asked is read when it arrives.
  }, [prompt?.nonce])

  // A chip that points at a turn brings it into view, and it brightens.
  useEffect(() => {
    if (!focusTurn) return
    const element = body.current?.querySelector<HTMLElement>(`[data-turn="${CSS.escape(focusTurn.id)}"]`)
    if (!element) return
    element.scrollIntoView({ block: 'center' })
    element.dataset.flash = ''
    const timer = window.setTimeout(() => delete element.dataset.flash, 600)
    return () => window.clearTimeout(timer)
  }, [focusTurn, thread.turns.length])

  const thatTurn = (turn: Turn): void => {
    agent.thatTurn(turn.id, here).then(
      (that) => {
        setPointed((known) => new Map(known).set(turn.id, that))
        setLabels((known) => new Map(known).set(that.id, that.label))
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    )
  }

  const decide = (proposal: ProposalView, accept: boolean): void => {
    agent.decide(proposal.id, accept).then(
      ({ proposal: decided, item }) => {
        setProposals((known) => known.map((other) => (other.id === decided.id ? decided : other)))
        if (item) onAccepted(item)
        input.current?.focus()
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    )
  }
  // Only this thread's proposals.
  const ours = proposals.filter((proposal) => (proposal.thread ?? PROJECT_THREAD) === here)
  const newest = ours.findLast((proposal) => proposal.state === 'open')

  // Proposals sit under the answer to the question that led to them; any
  // other (still being answered) at the end.
  const answered = new Map<string, string>()
  let question: string | undefined
  for (const turn of thread.turns) {
    if (turn.by === 'user') question = turn.id
    else if (question) answered.set(turn.id, question)
  }
  const shownWith = new Set(answered.values())
  const loose = ours.filter((proposal) => !proposal.asked || !shownWith.has(proposal.asked))
  const cards = (list: readonly ProposalView[]) =>
    list.map((proposal) => (
      <ProposalCard
        key={proposal.id}
        proposal={proposal}
        newest={proposal === newest}
        onDecide={(accept) => decide(proposal, accept)}
        onOpen={onOpenItem}
        onOpenThat={onOpenThat}
      />
    ))
  const turnView = (turn: Turn) => {
    const asked = answered.get(turn.id)
    return (
      <TurnView
        key={turn.id}
        turn={turn}
        labels={labels}
        onOpenThat={onOpenThat}
        that={pointed.get(turn.id)}
        onThat={() => thatTurn(turn)}
        onAddToNote={() => onAddToNote(turn.id, here)}
      >
        {asked && cards(ours.filter((proposal) => proposal.asked === asked))}
      </TurnView>
    )
  }

  const today = new Date().toDateString()
  const earlier = thread.turns.filter((turn) => new Date(turn.createdAt).toDateString() !== today)
  const recent = thread.turns.slice(earlier.length)
  const [unfolded, setUnfolded] = useState(false)
  const since = thread.turns[0] ? shortDate(thread.turns[0].createdAt) : undefined

  return (
    <aside
      className="agent-panel"
      aria-label={side ? `Side thread: ${side.title}` : threadId === NEW_SIDE ? 'New side thread' : 'Project thread'}
      onKeyDown={(event) => {
        // Tab accepts the newest proposal, Esc dismisses it, unless you are typing.
        if (!newest || draft.trim() || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
        if (event.key !== 'Tab' && event.key !== 'Escape') return
        if (event.target instanceof HTMLInputElement) return
        event.preventDefault()
        event.stopPropagation()
        decide(newest, event.key === 'Tab')
      }}
    >
      <header className="agent-head">
        <span className="agent-seat" aria-hidden="true">
          a
        </span>
        <div className="agent-title">
          <button type="button" className="agent-threads" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((now) => !now)}>
            <b>{side ? side.title : threadId === NEW_SIDE ? 'New side thread' : 'Project thread'}</b>
            <span aria-hidden="true">▾</span>
          </button>
          <span>
            {side ? 'side thread' : project}
            {since ? ` · ${side ? 'since' : 'ongoing since'} ${since}` : ''}
            {thread.total.calls > 0 ? ` · ${bytes(thread.total.bytes)} sent` : ''}
          </span>
          {menu && (
            <div className="agent-menu" role="menu" onKeyDown={(event) => event.key === 'Escape' && (event.stopPropagation(), setMenu(false))}>
              {[{ id: PROJECT_THREAD, title: 'Project thread' }, ...sides].map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={choice.id === threadId}
                  onClick={() => {
                    setMenu(false)
                    if (choice.id !== threadId) onThread(choice.id)
                  }}
                >
                  {choice.title}
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className="agent-menu-new"
                onClick={() => {
                  setMenu(false)
                  onThread(NEW_SIDE)
                }}
              >
                + New side thread
              </button>
            </div>
          )}
        </div>
        <button type="button" className="agent-close" aria-label="Close the thread" onClick={onClose}>
          ×
        </button>
      </header>

      <div className="agent-body" ref={body}>
        {thread.turns.length === 0 && !asking && (
          <p className="agent-empty">
            {threadId === PROJECT_THREAD
              ? 'Ask about what you are reading. The agent searches this project’s notes, sources and pages before it answers.'
              : 'A side thread keeps one topic apart from the project thread. Your first question names it.'}
          </p>
        )}
        {earlier.length > 0 && (
          <button type="button" className="agent-day" onClick={() => setUnfolded((now) => !now)}>
            <i />
            {unfolded ? 'Earlier' : `Earlier · ${earlier.length} turns, folded`}
            <i />
          </button>
        )}
        {unfolded && earlier.map(turnView)}
        {recent.length > 0 && earlier.length > 0 && (
          <p className="agent-day">
            <i />
            Today
            <i />
          </p>
        )}
        {recent.map(turnView)}
        {asking && (
          <>
            <Mine text={asking.text} points={asking.points} labels={labels} onOpenThat={onOpenThat} />
            <div className="agent-answer" data-live="">
              <Steps steps={asking.steps} cost={undefined} />
              {asking.answer ? <Markdown className="agent-text" text={asking.answer} onThat={onOpenThat} /> : <p className="agent-thinking">Thinking…</p>}
            </div>
          </>
        )}
        {cards(loose)}
        {error && (
          <p className="agent-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <footer className="agent-foot">
        {pointing.length > 0 && status?.ready && (
          <p className="agent-pointing">
            <span className="agent-lead">pointing at</span>
            {pointing.map((that) => (
              <span key={that.id} className="that-chip agent-point">
                {that.label || 'that.'}
                <button type="button" aria-label={`Stop pointing at ${that.label || 'that.'}`} onClick={() => onUnpoint(that.id)}>
                  ×
                </button>
              </span>
            ))}
          </p>
        )}
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
            <button type="button" className="agent-send" aria-label="Send" disabled={!draft.trim() || asking !== undefined} onClick={() => send()}>
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

function TurnView({
  turn,
  labels,
  onOpenThat,
  that,
  onThat,
  onAddToNote,
  children,
}: {
  turn: Turn
  labels: ReadonlyMap<string, string>
  onOpenThat: (id: string) => void
  /** The *that.* on this turn, once made. */
  that: ThatView | undefined
  onThat: () => void
  onAddToNote: () => Promise<ItemView>
  /** Proposals the answer made. */
  children?: ReactNode
}) {
  const [added, setAdded] = useState<string>()
  if (turn.by === 'user') return <Mine turn={turn.id} text={turn.text} kit={turn.kit} points={turn.points ?? []} labels={labels} onOpenThat={onOpenThat} />
  return (
    <div className="agent-answer" data-turn={turn.id} data-that={that ? '' : undefined}>
      <Steps steps={turn.steps ?? []} cost={turn.cost} />
      {turn.error ? (
        <p className="agent-error">No answer: {turn.error}</p>
      ) : (
        <>
          <Markdown className="agent-text" text={turn.text} onThat={onOpenThat} />
          <div className="turn-actions">
            {that ? (
              <span
                className="that-chip turn-chip"
                draggable
                title="Drag into a note to cite this turn"
                onDragStart={(event) => {
                  event.dataTransfer.setData(THAT_DRAG, JSON.stringify({ id: that.id, label: that.label }))
                  event.dataTransfer.setData('text/plain', that.label)
                  event.dataTransfer.effectAllowed = 'copy'
                }}
              >
                {that.label}
              </span>
            ) : (
              <button type="button" className="turn-that" aria-label="that. this turn" onClick={onThat}>
                that.
              </button>
            )}
            <button
              type="button"
              className="turn-note"
              onClick={() =>
                void onAddToNote().then(
                  (note) => setAdded(note.title),
                  () => setAdded(undefined),
                )
              }
            >
              {added ? `Added to “${added}”` : 'Add to note'}
            </button>
          </div>
        </>
      )}
      {children}
    </div>
  )
}

/** The turn a *that.* points at, if it points at one. */
function turnOf(that: ThatView): string | undefined {
  if (!that.itemId.startsWith('thread:')) return undefined
  for (const selector of that.selectors) {
    if (selector.type === 'FragmentSelector' && selector.value.startsWith('turn=')) return selector.value.slice('turn='.length)
  }
  return undefined
}

/** Your question, led by the chips it pointed at. */
function Mine({
  turn,
  text,
  kit,
  points,
  labels,
  onOpenThat,
}: {
  turn?: string
  text: string
  /** Asked by a learning kit for you: its title. */
  kit?: string | undefined
  points: readonly string[]
  labels: ReadonlyMap<string, string>
  onOpenThat: (id: string) => void
}) {
  return (
    <p className="agent-me" data-turn={turn} data-kit={kit}>
      {kit ? <span className="agent-kit">{kit} kit asked</span> : null}
      {points.map((id) => (
        <button key={id} type="button" className="that-chip" data-that={id} onClick={() => onOpenThat(id)}>
          {labels.get(id) || 'that.'}
        </button>
      ))}
      {points.length > 0 ? ' ' : ''}
      {text}
    </p>
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
