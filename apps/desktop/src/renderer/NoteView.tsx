import { Extension, InputRule, mergeAttributes, Node, type Editor, type JSONContent } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Placeholder } from '@tiptap/extensions'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

/**
 * A link to another note, `[[Elasticity]]` in the file. Typing [[ offers the
 * project's notes; typing a whole [[name]] makes one too. Clicking it opens
 * the note, or makes it when no note has that name yet.
 */
export const NoteLink = Node.create({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      target: { default: '' },
      label: { default: '' },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-note-link]', getAttrs: (element) => ({ target: element.getAttribute('data-note-link'), label: element.getAttribute('data-label') ?? '' }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const { target, label } = node.attrs as { target: string; label: string }
    return ['span', mergeAttributes(HTMLAttributes, { 'data-note-link': target, 'data-label': label, class: 'note-link' }), label || target]
  },
  addInputRules() {
    return [
      new InputRule({
        find: /\[\[([^[\]|\n]+)\]\]$/,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ target: match[1]!.trim(), label: '' }))
        },
      }),
    ]
  },
})

/** A place under the title for what the page shows there (the note's properties); the text flows around it. */
const UnderTitle = Extension.create<{ slot: () => HTMLElement | undefined }>({
  name: 'underTitle',
  addOptions() {
    return { slot: () => undefined }
  },
  addProseMirrorPlugins() {
    const slot = this.options.slot
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const element = slot()
            const first = state.doc.firstChild
            if (!element || !first) return DecorationSet.empty
            return DecorationSet.create(state.doc, [Decoration.widget(first.nodeSize, () => element, { key: 'under-title', side: -1, ignoreSelection: true, stopEvent: () => true })])
          },
        },
      }),
    ]
  },
})

/** Links to notes that don't exist yet look fainter, as in Obsidian. */
const LinkStatus = Extension.create<{ known: () => ReadonlySet<string> }>({
  name: 'linkStatus',
  addOptions() {
    return { known: () => new Set<string>() }
  },
  // A function, so the editor's option merging can't copy the set it reads.
  addProseMirrorPlugins() {
    const known = this.options.known
    return [
      new Plugin({
        props: {
          decorations: (state) => {
            const marks: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'noteLink' && !known().has(linkName(node.attrs.target as string).toLowerCase())) marks.push(Decoration.node(pos, pos + node.nodeSize, { class: 'unresolved' }))
            })
            return DecorationSet.create(state.doc, marks)
          },
        },
      }),
    ]
  },
})

/** The note a link names: "Elasticity#Rule" is "Elasticity" (`linkName` in @carrel/core). */
export function linkName(target: string): string {
  const hash = target.indexOf('#')
  return (hash >= 0 ? target.slice(0, hash) : target).trim()
}

/** The note a link names, if the project has it: by file name, then by title. */
export function resolveLink(target: string, notes: Iterable<ItemView>): ItemView | undefined {
  const name = linkName(target).toLowerCase()
  const all = [...notes].filter((item) => item.kind === 'note')
  return all.find((note) => note.name?.toLowerCase() === name) ?? all.find((note) => note.title.toLowerCase() === name)
}

/** Where [[ was typed, and what follows it. */
interface Suggest {
  from: number
  to: number
  query: string
  left: number
  top: number
}

function suggestAt(editor: Editor): Suggest | undefined {
  const { state, view } = editor
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.isTextblock) return undefined
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
  const match = /\[\[([^[\]|\n\ufffc]*)$/.exec(before)
  if (!match) return undefined
  const at = view.coordsAtPos($from.pos)
  return { from: $from.pos - match[0].length, to: $from.pos, query: match[1]!, left: at.left, top: at.bottom }
}

/** Up to eight notes for a [[ query: titles starting with it first, then the rest, most recent first. */
function candidatesFor(query: string, notes: readonly ItemView[], self: string): Array<{ note?: ItemView; create?: string }> {
  const wanted = query.trim().toLowerCase()
  const found = notes
    .filter((note) => note.kind === 'note' && note.id !== self && note.title.toLowerCase().includes(wanted))
    .sort((a, b) => Number(b.title.toLowerCase().startsWith(wanted)) - Number(a.title.toLowerCase().startsWith(wanted)) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 8)
    .map((note) => ({ note }))
  const exact = notes.some((note) => note.kind === 'note' && note.title.toLowerCase() === wanted)
  return wanted && !exact && !/[[\]|#^]/.test(query) ? [...found, { create: query.trim() }] : found
}

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
  NoteLink,
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
  notes = [],
  onOpenLink,
  underTitle,
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
  /** The project's notes, which [[ offers to link to. */
  notes?: readonly ItemView[]
  /** A [[link]] was clicked: open (or make) the note it names. */
  onOpenLink?: ((target: string) => void) | undefined
  /** Shown under the note's title line, outside its text. */
  underTitle?: ReactNode
}) {
  // The element `underTitle` is drawn into; the editor places it after the title.
  const slot = useMemo(() => {
    const element = document.createElement('div')
    element.className = 'note-under-title'
    element.contentEditable = 'false'
    return element
  }, [])
  const hasSlot = useRef(false)
  hasSlot.current = underTitle !== undefined
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
  const linkRef = useRef(onOpenLink)
  linkRef.current = onOpenLink
  // The names links may use, for telling links to missing notes apart.
  const known = useRef<ReadonlySet<string>>(new Set())
  const knownKey = notes.flatMap((note) => (note.kind === 'note' ? [note.name ?? '', note.title] : [])).join('\n').toLowerCase()
  // [[ typed: the notes it could link to, and which one is picked.
  const [suggest, setSuggest] = useState<Suggest>()
  const [picked, setPicked] = useState(0)
  const dismissed = useRef<number | undefined>(undefined)
  const candidates = suggest ? candidatesFor(suggest.query, notes, item.id) : []
  const live = useRef({ suggest, candidates, picked })
  live.current = { suggest, candidates, picked }

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

  const choose = (choice: { note?: ItemView; create?: string }): void => {
    const at = live.current.suggest
    if (!editor || !at) return
    const target = choice.note ? (choice.note.name ?? choice.note.title) : choice.create!
    const label = choice.note && choice.note.title !== target ? choice.note.title.replace(/[[\]\n]/g, ' ') : ''
    editor
      .chain()
      .focus()
      .insertContentAt({ from: at.from, to: at.to }, [
        { type: 'noteLink', attrs: { target, label } },
        { type: 'text', text: ' ' },
      ])
      .run()
    setSuggest(undefined)
  }
  const chooseRef = useRef(choose)
  chooseRef.current = choose
  const look = (changed: Editor): void => {
    const found = suggestAt(changed)
    if (found && dismissed.current === found.from) return setSuggest(undefined)
    dismissed.current = undefined
    setSuggest((now) => (found && now && now.from === found.from ? { ...found } : found))
    if (!found || found.from !== live.current.suggest?.from) setPicked(0)
  }
  const lookRef = useRef(look)
  lookRef.current = look

  const editor = useEditor({
    extensions: [...extensions, LinkStatus.configure({ known: () => known.current }), UnderTitle.configure({ slot: () => (hasSlot.current ? slot : undefined) })],
    editorProps: {
      // While [[ offers notes, the arrows pick one, Enter or Tab links it and Esc closes the list.
      handleKeyDown: (_view, event) => {
        const { suggest: open, candidates: list, picked: at } = live.current
        if (!open || list.length === 0) return false
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          setPicked((at + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          chooseRef.current(list[at]!)
          return true
        }
        if (event.key === 'Escape') {
          dismissed.current = open.from
          setSuggest(undefined)
          return true
        }
        return false
      },
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
        if (node.type.name === 'noteLink' && linkRef.current) {
          linkRef.current(node.attrs.target as string)
          return true
        }
        if (node.type.name !== 'that') return false
        openRef.current(node.attrs.id as string)
        return true
      },
    },
    onSelectionUpdate: ({ editor: changed }) => lookRef.current(changed),
    onUpdate: ({ editor: changed }) => {
      lookRef.current(changed)
      if (!ready.current) return
      pending.current = changed.getJSON() as NoteDoc
      docRef.current?.(pending.current)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => flushRef.current(), SAVE_AFTER)
    },
    onBlur: () => {
      flushRef.current()
      setSuggest(undefined)
    },
  })

  // Notes made or renamed elsewhere change which links point somewhere.
  useEffect(() => {
    known.current = new Set(knownKey.split('\n'))
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('linkStatus', true))
  }, [editor, knownKey])

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
      {underTitle !== undefined && createPortal(underTitle, slot)}
      {suggest &&
        candidates.length > 0 &&
        createPortal(
          <div className="link-suggest" role="listbox" aria-label="Link to a note" style={{ left: suggest.left, top: suggest.top + 4 }}>
            <div className="link-suggest-head">Link to a note</div>
            {candidates.map((choice, at) => (
              <button
                key={choice.note?.id ?? 'new'}
                type="button"
                role="option"
                aria-selected={at === picked}
                // Keep the editor's focus and selection while choosing.
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(choice)
                }}
                onMouseEnter={() => setPicked(at)}
              >
                {choice.note ? (
                  <>
                    <span className="grow">{choice.note.title}</span>
                    {choice.note.folder && <small>{choice.note.folder}</small>}
                  </>
                ) : (
                  <span className="grow muted">+ New note "{choice.create}"</span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
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
