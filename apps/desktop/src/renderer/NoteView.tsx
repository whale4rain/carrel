import { mergeAttributes, Node, type JSONContent } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef, useState } from 'react'
import type { ItemView, NoteDoc } from '../shared/workspace-api.js'
import { THAT_DRAG } from './ThatTray.js'

const api = window.carrel.workspace

/** Waits this long after the last keystroke before writing the note. */
const SAVE_AFTER = 500

/**
 * A *that.* chip inside a note: an inline atom holding the anchor's id and
 * the position it shows. In the file it is a link, `[p.42](that:<id>)`.
 */
export const ThatChip = Node.create({
  name: 'that',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: '' },
      label: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-that]', getAttrs: (element) => ({ id: element.getAttribute('data-that'), label: element.textContent ?? '' }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-that': node.attrs.id as string, class: 'that-chip note-chip' }), (node.attrs.label as string) || 'that.']
  },
})

/** Only what a note's Markdown keeps. */
const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: false,
  }),
  Placeholder.configure({
    placeholder: ({ node, pos }) => (pos === 0 && node.type.name === 'heading' ? 'Title' : 'Write here…'),
  }),
  ThatChip,
]

/** A new note starts with a title line. */
const EMPTY: JSONContent = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }, { type: 'paragraph' }] }

/**
 * A note on its sheet: the person's own writing, upright and in ink. It saves
 * itself a moment after typing stops, and when it loses focus.
 */
export function NoteView({
  item,
  write,
  onSaved,
  onOpenThat,
}: {
  item: ItemView
  write: boolean
  onSaved: (item: ItemView) => void
  /** A chip in the note was clicked: open the spot it points at. */
  onOpenThat: (id: string) => void
}) {
  const [error, setError] = useState<string>()
  // Edits count only once the note's own text is in.
  const ready = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<NoteDoc | undefined>(undefined)
  const savedRef = useRef(onSaved)
  savedRef.current = onSaved
  const openRef = useRef(onOpenThat)
  openRef.current = onOpenThat

  const flush = (): void => {
    window.clearTimeout(timer.current)
    const doc = pending.current
    if (!doc) return
    pending.current = undefined
    api.saveNote(item.id, doc).then(
      (saved) => {
        setError(undefined)
        savedRef.current(saved)
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)),
    )
  }
  const flushRef = useRef(flush)
  flushRef.current = flush

  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: { class: 'note-text', 'aria-label': 'Note' },
      // A chip dragged from the tray lands where it is dropped.
      handleDrop: (view, event) => {
        const carried = event.dataTransfer?.getData(THAT_DRAG)
        if (!carried) return false
        const chip = chipFrom(carried)
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (!chip || !at) return false
        event.preventDefault()
        const node = view.state.schema.nodes.that!.create(chip)
        view.dispatch(view.state.tr.insert(at.pos, [node, view.state.schema.text(' ')]))
        view.focus()
        return true
      },
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name !== 'that') return false
        openRef.current(node.attrs.id as string)
        return true
      },
    },
    onUpdate: ({ editor: changed }) => {
      if (!ready.current) return
      pending.current = changed.getJSON() as NoteDoc
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => flushRef.current(), SAVE_AFTER)
    },
    onBlur: () => flushRef.current(),
  })

  useEffect(() => {
    if (!editor) return
    let current = true
    void api.note(item.id).then((note) => {
      if (!current) return
      editor.commands.setContent(note.doc.content.length > 0 ? (note.doc as JSONContent) : EMPTY, { emitUpdate: false })
      ready.current = true
      setLoaded(true)
    })
    return () => {
      current = false
    }
  }, [editor, item.id])

  // A note just asked for from the sidebar takes the keyboard.
  useEffect(() => {
    if (write && loaded) editor?.commands.focus(editor.isEmpty ? 'start' : 'end')
  }, [write, loaded, editor])

  // Leaving the desk (or the sheet scrolling out of view) writes what's left.
  useEffect(() => () => flushRef.current(), [])

  return (
    <div className="note-view" data-scrolls>
      <EditorContent editor={editor} />
      {error && (
        <p className="note-error" role="alert">
          Not saved: {error}
        </p>
      )}
    </div>
  )
}

/** What a dragged chip carries, if it is one. */
function chipFrom(carried: string): { id: string; label: string } | undefined {
  try {
    const chip = JSON.parse(carried) as { id?: unknown; label?: unknown }
    return typeof chip.id === 'string' && /^[\w-]+$/.test(chip.id) && typeof chip.label === 'string' ? { id: chip.id, label: chip.label } : undefined
  } catch {
    return undefined
  }
}
