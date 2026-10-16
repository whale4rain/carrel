import { Extension, mergeAttributes, Node, type JSONContent } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef, useState } from 'react'
import type { ItemView, NoteDoc } from '../shared/workspace-api.js'
import { THAT_DRAG } from './ThatTray.js'

const api = window.carrel.workspace

/** Sent on window (detail: the note id) when a note changed outside its editor, such as an accepted proposal. */
export const NOTE_CHANGED = 'carrel:note-changed'

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

/** The same #tag pattern the notes use (`tagsOf` in @carrel/core). */
const TAG = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu

/** #tags in the text show as tags; they stay plain text in the file. */
const Tags = Extension.create({
  name: 'tags',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const marks: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              for (const match of node.text.matchAll(TAG)) {
                const from = pos + match.index + match[1]!.length
                marks.push(Decoration.inline(from, from + match[2]!.length + 1, { class: 'note-tag' }))
              }
            })
            return DecorationSet.create(state.doc, marks)
          },
        },
      }),
    ]
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
  Tags,
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
  cites,
  onDoc,
}: {
  item: ItemView
  write: boolean
  /** What the note cites, in words: "Cites a paper and a video." */
  cites: string | undefined
  onSaved: (item: ItemView) => void
  /** A chip in the note was clicked: open the spot it points at. */
  onOpenThat: (id: string) => void
  /** The note's text as it is now: once loaded, then after each change. */
  onDoc?: (doc: NoteDoc) => void
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
  const docRef = useRef(onDoc)
  docRef.current = onDoc

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
      docRef.current?.(pending.current)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => flushRef.current(), SAVE_AFTER)
    },
    onBlur: () => flushRef.current(),
  })

  // A note changed elsewhere (an accepted proposal) is read again. Leaving the
  // editor to accept already wrote what was typed.
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const changed = (event: Event): void => {
      if ((event as CustomEvent<string>).detail === item.id) setRevision((now) => now + 1)
    }
    window.addEventListener(NOTE_CHANGED, changed)
    return () => window.removeEventListener(NOTE_CHANGED, changed)
  }, [item.id])

  useEffect(() => {
    if (!editor) return
    let current = true
    void api.note(item.id).then((note) => {
      if (!current) return
      editor.commands.setContent(note.doc.content.length > 0 ? (note.doc as JSONContent) : EMPTY, { emitUpdate: false })
      ready.current = true
      setLoaded(true)
      docRef.current?.(editor.getJSON() as NoteDoc)
    })
    return () => {
      current = false
    }
  }, [editor, item.id, revision])

  // A note just asked for from the sidebar takes the keyboard.
  useEffect(() => {
    if (write && loaded) editor?.commands.focus(editor.isEmpty ? 'start' : 'end')
  }, [write, loaded, editor])

  // Leaving the desk (or the sheet scrolling out of view) writes what's left.
  useEffect(() => () => flushRef.current(), [])

  return (
    <div className="note-view" data-scrolls>
      <EditorContent editor={editor} />
      {cites && <p className="note-cites">{cites}</p>}
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
