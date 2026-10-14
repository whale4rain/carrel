# AGENTS.md

Guide for agents (and people) working on Carrel. Read this first.

Carrel is a desktop app for long-running study and research, built on
[tnega](https://github.com/whale4rain/tnega). You lay out books, linked videos,
web pages and notes on a free-layout **desk**, point at exact passages or
moments with ***that.***, write notes that cite them, and keep the tnega agent
one shortcut away. **Learning kits** (plugins) shape the desk for different
kinds of learning.

Owner: Ocean Rain (`whale4rain`).

## Design artifacts

These are the source of truth. Where they disagree with this file, they win.

| Artifact | Link | Use it for |
| --- | --- | --- |
| Technical design doc | https://claude.ai/code/artifact/294fb705-758e-480d-b41c-5f2b88e61ac0 | Architecture, data model, kits, milestones, decisions |
| Margin design system | https://claude.ai/artifact/XoE23rtgHg2FV3qgS5RHWe | `tokens.json`, principles, interaction rules, components |
| Design canvas (mockups) | https://claude.ai/artifact/QCkFRyRneRVGMovNWmFAi4 | Screens |
| Pillars doc | https://claude.ai/code/artifact/54c90afc-28be-4f92-9672-77d1a3f2506e | Philosophy: attention, memory, agency |
| Early concept deck | https://claude.ai/artifact/AgSqPZbYUHj3GzwGwCwosm | History only; superseded |

**Baseline mockups:** `MarginMac2`, `MarginFocus`, `MarginCompare`,
`MarginMac`, `MarginWin`, plus `MarginTalk` and `MarginDesk` for details.
Ignore `Main`, `Windows` and `Sheet` (older style). The Read/Watch/Compare/Write
buttons in `MarginDesk` were replaced by Focus and Compare actions.

## Working agreements

- Plain language, concise answers.
- Discuss concepts before building; the owner judges designs by seeing them, so show samples.
- Decisions go into the design doc's "Decisions (14 Oct)" table, not chat.
- Agents open pull requests; the owner reviews and merges. Pencil until inked applies to code too.

## Product (summary)

**Structure:** one project has many desks. A desk *shows* items; it never owns them.

| Level | Owns |
| --- | --- |
| You | Global library, all notes, tags |
| Project | Sources, notes, conversations, kits, learner progress |
| Desk | Sheets and their positions, sizes, scales |
| Sheet | Only where and how big it is |

**Interaction:**

- Free layout is the default and only lasting mode: move, resize (8 handles), overlap, scale (30–100%), pile; snap guides, Tidy up, minimap and zoom.
- Selection bar (dark, under the selection): Focus, Compare, Make a pile, Scale, *that.*
- Focus (double-click or ⌘↵ / Ctrl+↵): one sheet fills the desk, others wait on a shelf; Esc returns.
- Compare (2+ selected): side by side, scroll together, add a sheet; Esc returns.
- Agent: one ongoing project thread in a right panel (⌘J / Ctrl+J), plus side threads. Working steps fold into one line. Any turn can be *that.*-ed or added to a note.
- Proposals: the agent never writes directly. Its changes show in pencil (dashed blue) until Accept (Tab) or Dismiss (Esc).
- Notes are long-term assets, tagged and searchable across projects, citing sources, turns and notes as *that.* chips.
- Library: books and papers are stored files; videos and web pages are linked, never downloaded.
- Cost display in v1: each answer's steps line shows what was sent and its size; each project shows a running total.

**Margin, briefly:** grid-paper `mat` surface with `paper` sheets (4px corners,
flat shadow). Your writing is upright Instrument Sans in `ink`; the agent's
marginalia is italic Literata in blue `pencil`; its long answers are upright
Literata in ink. Yellow `highlight` means *that.* and nothing else. A red-pink
margin line between a source and its notes is the signature. Positions (pages,
timestamps) are JetBrains Mono. Day and Night themes; Mac and Windows frames.

## Technical (summary)

- **Stack:** Electron 44 + React 19 + TypeScript + Vite, pnpm monorepo. Depend on tnega's published packages; don't fork them.
- **On tnega:** a Carrel project is a tnega Project (the project thread is its main conversation; side threads are tnega Threads). Library extends `artifact-store`. Learner progress lives in the Blackboard plus Memory. Web pages use tnega's browser seam. Carrel features are tnega plugins on `@tnega/core` (viewer, source, anchor seams); agent tools are tnega tool plugins.
- **Desk engine:** our own, on DOM with CSS transforms and a small gesture library. Mount only sheets in view. One live web view at a time; inactive web sheets show `capturePage()` snapshots.
- **Video:** official embedded players in iframes, native view fallback while focused; one audio source at a time.
- ***that.* anchors:** W3C Web Annotation selectors (TextQuote, TextPosition, time-range Fragment, rectangle) plus a snapshot. Re-anchor: exact position, then quoted text, then snapshot.
- **Storage:** user content in visible `~/Carrel/<project>/` (Markdown notes, desk JSON, snapshots, kit stores). Internals in hidden `~/.carrel/` (settings, kits, SQLite index, caches, logs). No SQLite in `~/Carrel/`. Every change is an event with its actor.
- **Agent tools:** `search_project`, `read_item`, `resolve_that`, `make_that`, `point`, `propose_note_edit`, `propose_source`, `propose_view`. No tool writes directly; every write is a proposal.
- **Platforms:** Mac and Windows.

## Learning kits (summary)

- A kit is data plus sandboxed pages, loaded as a tnega plugin with hot reload.
- Sheets: plain HTML in a sandboxed iframe (no network, files or Node), Margin tokens injected.
- Backend: the kit's own store, per project. Background logic: small QuickJS scripts touching only that store.
- Host API over `postMessage`: `kit.store.*`, `kit.read`, `kit.propose`, `kit.that.receive`, `kit.agent.ask`, `kit.fetch` (allowlist), `kit.srs.schedule`, `kit.speak`.
- Manifest declares sheets, store schema version, scripts, `reads`, `net`, `needs`; approved once by the user.
- Permissions: read wide, write narrow. Own store: read/change always, soft delete. Rest of project: read if approved, change only by proposal, never delete.
- Builder flow: describe need, agent proposes a pencil card, builds and tests in scratch on Accept, hot-loads on a trial desk, user picks Keep, Revise or Discard.
- First-party kits live in `kits/`. First kit: language (beginner, intermediate, advanced; only the user moves the stage).

## Development plan

Full plan: the design doc's "Development plan" section. In short: prove the
risky parts with spikes, then build the core loop (desk, source, *that.*,
note, agent) end to end, thinly, then polish in the order the owner uses it.

| Phase | What gets built |
| --- | --- |
| 0. Setup | Monorepo, tnega dependency, lint, typecheck, tests, CI on Mac and Windows |
| 1. Spikes | Live web on the desk; video in a sheet; tnega integration (tnega spike first) |
| 2. Foundation (M1) | Margin tokens to CSS, window frames, sidebar, projects and desks on disk |
| 3. Desk (M2) | Move, resize, overlap, scale, pile, undo, Tidy up, one-live-view rule |
| 4. Sources and *that.* (M3) | PDF, web and video viewers; capture; re-anchoring |
| 5. Notes (M4) | Editor with *that.* chips, tags, backlinks, search |
| 6. Agent (M5) | Thread panel, context, tools, folded steps, proposals, cost line |
| Checkpoint | The owner uses Carrel for a week or two; fix what annoys |
| 7. Kits (M6) | Kit host, sandbox, permissions, store, builder flow, language kit |
| 8. Focus, Compare, beta (M7) | Focus and Compare, Windows polish, crash reports, installer |

Rules for every task:

- One PR per task, small enough to review in one sitting.
- Every PR says how to try it, with a screenshot or recording for anything visual.
- Tests: unit tests per package; a few desk interaction tests; one end-to-end test of the core loop from phase 6 on. CI runs on Mac and Windows.
- A PR that changes a decision updates the design doc's decision table.
- Token changes go into the Margin design system first, then get regenerated into code.

## Repository

```
apps/desktop      Electron app (main process via esbuild, renderer via Vite + React)
packages/core     Carrel data model and workspace files, on tnega
packages/margin   Margin tokens and components
kits/             First-party learning kits (later)
```

tnega comes from npm as the `tnega` package; import its parts by subpath
(`tnega/core`, `tnega/project`, `tnega/agent`, ...). Don't copy its code.

Commands (Node 22.19+, pnpm 10):

| Command | Does |
| --- | --- |
| `pnpm install` | Install everything |
| `pnpm check` | Lint, typecheck and unit tests (what CI runs first) |
| `pnpm build` | Build the desktop app |
| `pnpm dev` | Build and open the desktop app |
| `pnpm --filter @carrel/desktop smoke` | Start the built app, check it renders, quit |

## Milestone 1 (next)

One pull request each, in order:

1. Scaffold the pnpm monorepo (`apps/desktop`, `packages/core`, `packages/margin`, tnega dependency, lint/typecheck/test).
2. Margin tokens to CSS variables (Day and Night) from `tokens.json`.
3. Electron shell: Mac and Windows frames, empty grid-paper desk, sidebar skeleton.
4. Projects and desks on disk in `~/Carrel/<project>/`, reopened after restart.
