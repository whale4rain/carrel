# Margin

Margin is the design language of tnega. It covers every surface where a person and an agent work on the same material: the desktop desk, the phone, the browser extension, shared desks on the web, and how tnega presents itself in public.

The name comes from the space beside a page. The material sits in the middle and belongs to its author. Thinking happens in the margin: your notes, the agent's notes, the marks that point back into the text. Margin designs that space.

It rests on tnega's three pillars:

| Pillar | Question | In Margin |
| --- | --- | --- |
| Attention | What are we both looking at? | One mark for pointing: the highlighter, *that.* |
| Memory | Where does shared understanding live? | Paper on a desk: durable things look durable |
| Agency | Who did this, and who should grow? | Two hands: your ink and the agent's blue pencil |

## Principles

1. **The material is the page; we live in the margin.** Chrome never covers a source. Tools, notes and the agent sit beside it, and appear on hover or focus.
2. **Two hands, always visible.** Everything on the desk has an author. You write in ink: upright sans, `ink` color. The agent writes in blue pencil: italic serif, `pencil` color. Never tell them apart by color alone. One exception, for reading comfort: long answers in a conversation are set in `font-read` upright, in `ink`, beside the agent's seat marker. Pencil stays for the agent's marginalia, its suggestions and anything it asks you directly ("Your turn").
3. **Pencil until inked.** Whatever the agent proposes is drawn in pencil: dashed outline, `pencil` color, `pencil-wash` ground. When you accept it, it becomes ink and keeps its source mark.
4. **One mark for pointing.** *that.* is a highlighter. In the source it is a `highlight-soft` band under the words; in the margin it is a `highlight` chip. Yellow means *that.* and nothing else.
5. **Paper persists, views pass.** Durable things (sources, notes, decisions) are paper: opaque, crisp corners, a flat `shadow-sheet`. Views the agent generates on the fly sit unframed on the mat until you pin them; pinning lays them on paper.
6. **A calm desk.** One emphasis at a time. Motion settles like paper landing; it never performs.
7. **Your layout is yours.** Free layout is the default and the only lasting mode. Anything that rearranges the desk for you (Focus, Compare, Tidy up) is temporary or undoable, and Esc always brings back your own arrangement.

## Structure

One project holds many desks. A desk shows things; it never owns them.

| Level | What it is | Example | What lives here |
| --- | --- | --- | --- |
| You | Everything you have built up | — | The global library, all notes, tags |
| Project | A long-running goal | Learn economics | Its sources, notes and conversations; the output-to-growth dial |
| Desk | One working surface | Elasticity · Comparing textbooks | Sheets and their positions, sizes and scales |
| Sheet | One item opened on a desk | Lecture 4 at 12:34 | Only where and how big it is |

Closing a desk, or rearranging it, never loses anything. The same note can sit on two desks.

## The desk

Sheets lie on the grid-paper `mat` and can be moved, resized, overlapped and scaled down.

- **Move:** drag by the label row. While dragging, a sheet takes `shadow-lift` and rises above others. Snap guides are 1px dashed `margin-line`, shown only while dragging.
- **Resize:** select a sheet to show eight square handles (8px, `paper` fill, 1.5px `ink` border) and a size label in `position` style.
- **Scale down:** any sheet can be shown at 30–100%. A scaled sheet shows its scale on its label ("40%").
- **Pile:** select several sheets and Make a pile. A pile is a stack of scaled sheets with its count on top; the top sheet lifts slightly.
- **Draw:** you can draw on the mat in your own `ink`, 2.4px round strokes. Drawings belong to the desk.
- **Selection bar:** selecting one or more sheets shows a dark `ink` bar under the selection with the actions that apply: Compare side by side, Focus, Make a pile, and *that.* (a `highlight` button).
- **Find your way:** a small map of the whole desk and zoom controls sit bottom right, with Tidy up beside them.

## Focus and Compare

Both are actions on sheets, never tabs at the top of the window.

- **Focus** (double-click or ⌘↵ / Ctrl+↵): one sheet fills the desk with a wide margin. The rest wait on a shelf strip along the bottom, as small cards you can swap in. A dark bar at the top says "Focus" with Back to desk (Esc). Reading, watching and writing are simply Focus on a book, a video or a note.
- **Compare** (select two or more, then Compare): sheets line up side by side at equal size, with Scroll together, + Add a sheet and Back to desk (Esc). The agent marks matching passages with numbered `pencil` badges on both sides: solid where the sources agree, dashed where one only hints. A summary card offers *that.* this comparison and Add to note.

## The agent

- Each project has one **ongoing thread** with the agent. It opens from anywhere as a panel on the right (⌘J / Ctrl+J), over whatever desk you are on. Side threads hold topics that deserve their own.
- The thread reads as a normal linear chat. Your messages sit right in `paper-2`; the agent's sit left beside its seat marker, in `font-read`.
- Its working steps are folded into one `position`-style line ("▸ Read 2 sources"). Open it to see what it read and did.
- Every turn can be pointed at: *that.* this turn, or Add to note. Earlier days fold into one line.
- The composer in the panel picks up your current selection as what you are "pointing at".
- Generated views (charts, tables) stay unframed with a dashed `graphite` outline until you Pin to desk.

## Notes and library

- **Notes are long-term.** They belong to the project, carry tags, and are searchable across projects. A note can cite a source, a conversation turn or another note, each as a *that.* chip with its type icon.
- **Library** is sorted by type automatically and by your tags. Books and papers are **stored** files. Videos and web pages are **linked**: they play or open in the built-in browser and are never downloaded. A *that.* on a video keeps the timestamp, a transcript snippet and one frame, so it still works if the video goes away.

## Sidebar

Top to bottom: project switcher, Search everything (⌘K / Ctrl+K), Desks, Notes (pinned notes, All notes, tags), Conversations (the project thread with an unread count, then side threads), Library (by type, link icon for linked items), and at the foot All projects and Global library. The open desk is an `ink` row with a small `highlight` dot.

## Color

The palette is the desk itself: a cutting-mat surface, paper, ink, a blue pencil and a highlighter.

- `mat` is the desk surface behind everything. Only sheets, the composer and seat markers sit directly on it. Text on the mat uses `ink`.
- `paper` is every durable object. `paper-2` is recessed paper: inputs, wells, secondary panes.
- `ink` is your text and the default text. `ink-muted` is for labels, positions and captions on paper.
- `margin-line` is the vertical rule between a source and its margin. It is the signature of the system; use it only for that boundary.
- `pencil` is the agent's ink: its notes, proposals and gaze ring. `pencil-wash` is the ground under a proposal.
- `highlight` is the *that.* chip fill, always with `highlight-ink` text. `highlight-soft` is the band under highlighted source text.
- `graphite` draws dashed outlines for anything provisional.
- `success`, `warning` and `danger` are states only. They never decorate.

Do: keep yellow for pointing, blue for the agent. Don't: use `pencil` for your own buttons or links (use `ink`), or use `highlight` for warnings.

## Type

- **Instrument Sans** (`font-ui`) for the interface and your notes. Upright, compact, quiet.
- **Literata** (`font-read`) for reading material and for the agent's marginalia, in italic. It was drawn for long reading on screens.
- **JetBrains Mono** (`font-mono`) for positions: page numbers, timestamps, slide numbers. Positions are always visible and always mono, so a person learns where a *that.* points at a glance.

Styles: `display` and `title` (Literata) for headings in public surfaces and sheet titles; `heading`, `body`, `label`, `caption` (Instrument Sans) for the interface; `reading` for source text; `marginalia` for the agent's notes; `position` for locations.

## Shape and space

- Sheets have `radius-sheet` (4px): paper corners, not cards. Controls have `radius-control` (8px). *that.* chips have `radius-mark` (2px), like a highlighter stroke. Only seat markers are round (`radius-seat`).
- Spacing runs on a 4px grid: `space-1` (4) to `space-12` (48). The margin column sits beside a source, at least 5 × `space-12` (240px) wide, separated by the margin line.
- `shadow-sheet` is paper lying flat. `shadow-lift` is paper picked up: dragging, the floating composer, a torn-off sheet.

## Motion

- **Settle:** 180 ms ease-out. Sheets, chips and cards land; they don't bounce.
- **Ink in:** 240 ms. When a proposal is accepted, the dashed pencil outline fades and the text darkens from `pencil` to `ink`.
- **Point:** when a *that.* is activated, its source band and its chip brighten together for 600 ms.
- Respect reduced-motion settings: replace all of the above with an instant change.

## Surfaces

| Surface | What it is | How Margin shows up |
| --- | --- | --- |
| Desk on Mac | The full app in a standard Mac window | Full system; traffic-light buttons, ⌘ shortcuts, sidebar under a unified toolbar |
| Desk on Windows | The same app in a Windows 11 window | Full system; caption buttons on the right, a separate command bar, Ctrl shortcuts, a small `ink` bar marks the selected sidebar row |
| Pocket (phone) | Capture and review away from the desk | One sheet at a time; the margin slides up as a sheet; *that.* by long-press |
| *that.* in the browser | Point at anything on the web and send it to a desk | Only the highlighter and the chip; nothing else of tnega appears on other sites |
| Shared desk (web) | Others sit at your desk | Seat markers for every person and agent; each hand keeps its own ink |
| Public (site, decks) | How tnega presents itself | Mat and paper as ground, Literata display, the margin line as the brand device |

## Voice

- Write plainly, in second person. "You stopped at 31:20," not "Your session was interrupted."
- The agent speaks in short marginal notes: one or two sentences, always with a *that.* when it refers to a source.
- The agent never claims your work. Proposals say "Suggest", accepted text says nothing.
- In growth mode the agent asks questions, and offers "Just tell me" every time.

## Iconography

Line icons, 1.75px stroke, round caps, drawn on a 24px grid. One icon per source type: book, play (video), slide, page (web), note, spark (agent-made). Icons carry the source type next to every position; they never decorate headings.
