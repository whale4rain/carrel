import { fromMarkdown, type NoteBlock, type NoteInline } from '@carrel/core/note-markdown'
import type { ReactNode } from 'react'

/**
 * A little Markdown, read the way notes are (paragraphs, headings, lists,
 * quotes, bold, italic, code) and drawn as plain elements. The agent's
 * answers arrive this way.
 */
export function Markdown({ text, className, onThat }: { text: string; className?: string; onThat?: (id: string) => void }) {
  const blockOf = (block: NoteBlock, key: number): ReactNode => drawBlock(block, key, onThat)
  return <div className={className}>{fromMarkdown(text).content.map(blockOf)}</div>
}

/** *that.* chips open their spot when `onThat` is given. */
function drawBlock(block: NoteBlock, key: number, onThat: ((id: string) => void) | undefined): ReactNode {
  const blockOf = (inner: NoteBlock, at: number): ReactNode => drawBlock(inner, at, onThat)
  const inlines = (content: readonly NoteInline[]): ReactNode[] => drawInlines(content, onThat)
  switch (block.type) {
    case 'paragraph':
      return <p key={key}>{inlines(block.content ?? [])}</p>
    case 'heading':
      return <h3 key={key}>{inlines(block.content ?? [])}</h3>
    case 'blockquote':
      return <blockquote key={key}>{block.content.map(blockOf)}</blockquote>
    case 'bulletList':
    case 'orderedList': {
      const items = block.content.map((item, at) => <li key={at}>{item.content.map(blockOf)}</li>)
      return block.type === 'bulletList' ? <ul key={key}>{items}</ul> : <ol key={key}>{items}</ol>
    }
  }
}

function drawInlines(content: readonly NoteInline[], onThat: ((id: string) => void) | undefined): ReactNode[] {
  return content.map((node, at) => {
    if (node.type === 'hardBreak') return <br key={at} />
    if (node.type === 'that') {
      const label = node.attrs.label || 'that.'
      return onThat ? (
        <button key={at} type="button" className="that-chip" data-that={node.attrs.id} onClick={() => onThat(node.attrs.id)}>
          {label}
        </button>
      ) : (
        <span key={at} className="that-chip">
          {label}
        </span>
      )
    }
    let text: ReactNode = node.text
    for (const mark of node.marks ?? []) {
      text = mark.type === 'bold' ? <strong>{text}</strong> : mark.type === 'italic' ? <em>{text}</em> : <code>{text}</code>
    }
    return <span key={at}>{text}</span>
  })
}
