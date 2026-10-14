# Carrel design, for kit authors and their agents

Carrel's look and behavior come from **Margin**, its design system. A learning
kit should feel like part of Carrel, not a web page inside it. This folder holds
what you (or the agent helping you) need to get there.

Copied from the live design artifacts on 14 Oct 2026. If they disagree with the
live [Margin design system](https://claude.ai/artifact/XoE23rtgHg2FV3qgS5RHWe),
the live one wins.

## What's here

| Path | What it is | Read it when |
| --- | --- | --- |
| [`margin/README.md`](margin/README.md) | The brand book: principles, color, type, shape, motion, voice | Before designing any sheet |
| [`margin/tokens.json`](margin/tokens.json) | The single source of truth for colors (Day and Night), type, spacing, radii, shadows | Whenever you pick a value |
| [`margin/components/`](margin/components/) | One guideline (`README.md`) and an HTML sample (`preview.html`) per component | When your sheet needs a button, a *that.* chip, a proposal, and so on |
| [`mockups/`](mockups/) | The baseline app screens, as PNG and source HTML | To see how a sheet sits on the desk |

The mockups: `MarginMac2` (sidebar, desk, agent panel), `MarginFocus` (one sheet
in Focus), `MarginCompare` (two sheets side by side), `MarginMac` and
`MarginWin` (free layout on each platform). Open the `.png` to look; the
`.dc.html` files open in a browser and carry exact values in inline styles.

## How a kit sheet gets Margin

A kit sheet is a plain HTML page in a sandboxed iframe. Carrel injects the
Margin tokens as CSS variables, so use them and never hard-code a color, font,
radius or shadow:

| Token group | Variable | Examples |
| --- | --- | --- |
| Color | `--<name>` | `--paper`, `--ink`, `--ink-muted`, `--pencil`, `--highlight` |
| Font family | `--font-ui`, `--font-read`, `--font-mono` | |
| Spacing | `--space-<n>` | `--space-4` (16px), `--space-6` (24px) |
| Radius | `--radius-<name>` | `--radius-sheet`, `--radius-control`, `--radius-mark` |
| Shadow | `--shadow-<name>` | `--shadow-sheet`, `--shadow-lift` |

The variables switch between Day and Night for you. Type styles (`body`,
`label`, `reading`, `position`, ...) are size, line height and weight sets in
`tokens.json`; apply them with those values. The component previews use the same
variables, so they show the pattern (they look unstyled outside Carrel).

## Rules a kit must keep

These come straight from the brand book; reread it for the reasons.

1. **Two hands.** The learner writes in ink: upright `--font-ui`, `--ink`. The agent writes in pencil: italic `--font-read`, `--pencil`. Never tell them apart by color alone.
2. **Pencil until inked.** Anything the agent or your kit proposes outside its own store shows as a proposal: `--pencil-wash` ground, 1px dashed `--pencil` border, "SUGGEST" tag, Accept (Tab) or Dismiss (Esc). See [`Hands`](margin/components/Hands/README.md).
3. **Yellow means *that.*** `--highlight` and `--highlight-soft` are only for pointing. Not for warnings, selection or emphasis. See [`That`](margin/components/That/README.md).
4. **Blue means the agent.** Never use `--pencil` for your own buttons or links; use `--ink`.
5. **Positions are mono.** Pages, timestamps, card numbers: `--font-mono`, `position` style, always visible.
6. **Paper, not cards.** Sheets use `--radius-sheet` (4px) and `--shadow-sheet`. Controls use `--radius-control` (8px). Only seat markers are round.
7. **One ink button per view.** The main action is the filled `--ink` button; the rest are outline or quiet. See [`Button`](margin/components/Button/README.md).
8. **A calm sheet.** One emphasis at a time. Motion settles in 180 ms ease-out, never bounces, and turns off under reduced motion.
9. **Plain voice.** Second person, short sentences. "You know 42 words," not "Vocabulary acquisition: 42 items."
10. **States only for state.** `--success`, `--warning`, `--danger` mark state and never decorate.

## For agents building a kit

- Read `margin/README.md` and the component guidelines your sheet uses before writing HTML.
- Take every value from `tokens.json` through the CSS variables above. If you need a value that isn't a token, ask the person rather than inventing one.
- Check your sheet in Day and Night.
- Compare it with a mockup: does it look like it belongs on the desk in `MarginMac2`?
- Kit structure (manifest, store, host API, permissions) is in the technical design, linked from [`AGENTS.md`](../../AGENTS.md).
