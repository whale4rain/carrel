# Sheet

A sheet is one source or note laid on the desk as paper, with its margin beside it.

- Ground: `paper`, `radius-sheet`, `shadow-sheet`. Lifted (dragging, torn off): `shadow-lift`.
- The label row sits inside the paper, top-left: type icon, title, position in `position` style. No title bar.
- The margin column sits right of the source, divided by a 2px `margin-line`. Your notes are `body` in `ink`; the agent's are `marginalia` in `pencil`.
- Tools (Follow, Pop out) appear on hover or focus at the label row's right end.
- While the agent reads a sheet, it gets a 2px `pencil` ring outside the paper.
- Source text uses `reading`. Highlighted text sits on `highlight-soft`.

The consumer provides the source content, the position and the margin notes.
