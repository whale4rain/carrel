import { fromMarkdown, type NoteBlock, type NoteInline } from '@carrel/core/note-markdown'
import type { ReactNode } from 'react'

/**
 * A little Markdown, read the way notes are (paragraphs, headings, lists,
 * quotes, bold, italic, code) and drawn as plain elements. The agent's
 * answers arrive this way.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{fromMarkdown(text).content.map((block, at) => blockOf(block, at))}</div>
}

function blockOf(block: NoteBlock, key: number): ReactNode {
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

function inlines(content: readonly NoteInline[]): ReactNode[] {
  return content.map((node, at) => {
    if (node.type === 'hardBreak') return <br key={at} />
    if (node.type === 'that') return <span key={at} className="that-chip">{node.attrs.label || 'that.'}</span>
    let text: ReactNode = node.text
    for (const mark of node.marks ?? []) {
      text = mark.type === 'bold' ? <strong>{text}</strong> : mark.type === 'italic' ? <em>{text}</em> : <code>{text}</code>
    }
    return <span key={at}>{text}</span>
  })
}
