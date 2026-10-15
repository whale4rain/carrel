import type { ProposalView } from '../shared/agent-api.js'
import { Markdown } from './Markdown.js'

/**
 * A change the agent proposed, in pencil: dashed outline on pencil-wash, a
 * SUGGEST tag, and the text that will land. Accept (Tab) inks it; Dismiss
 * (Esc) removes it. Accepted, it keeps only a quiet way to open what it made.
 */
export function ProposalCard({
  proposal,
  newest,
  onDecide,
  onOpen,
  onOpenThat,
}: {
  proposal: ProposalView
  /** The newest open proposal answers Tab and Esc. */
  newest: boolean
  onDecide: (accept: boolean) => void
  onOpen: (itemId: string) => void
  onOpenThat: (id: string) => void
}) {
  if (proposal.state === 'dismissed') return null
  const { change } = proposal
  const what = change.kind === 'source' ? 'a source' : change.note !== undefined ? `an addition to “${proposal.target ?? 'a note'}”` : 'a new note'
  const accepted = proposal.state === 'accepted'
  return (
    <section className="proposal" data-state={proposal.state} data-proposal={proposal.id} aria-label={accepted ? `Accepted: ${what}` : `Suggested: ${what}`}>
      {!accepted && (
        <p className="proposal-tag">
          SUGGEST <span>· {what}</span>
        </p>
      )}
      {change.kind === 'source' ? (
        <p className="proposal-text proposal-url">{change.url}</p>
      ) : (
        <Markdown className="proposal-text" text={change.text} onThat={onOpenThat} />
      )}
      {!accepted && proposal.why && <p className="proposal-why">{proposal.why}</p>}
      {accepted ? (
        proposal.result && (
          <button type="button" className="proposal-open" title={`From the agent, accepted ${shortDate(proposal.decidedAt)}`} onClick={() => onOpen(proposal.result!)}>
            Open {change.kind === 'source' ? 'source' : 'note'}
          </button>
        )
      ) : (
        <div className="proposal-actions">
          <button type="button" className="proposal-accept" onClick={() => onDecide(true)}>
            Accept{newest && <span className="kbd">Tab</span>}
          </button>
          <button type="button" className="proposal-dismiss" onClick={() => onDecide(false)}>
            Dismiss{newest && <span className="kbd">Esc</span>}
          </button>
        </div>
      )}
    </section>
  )
}

function shortDate(iso: string | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''
}
