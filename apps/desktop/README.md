# @carrel/desktop

The Carrel desktop app: Electron main process (bundled with esbuild) and a
React renderer (bundled with Vite).

![Mac and Windows frames, Day and Night](screenshot.png)

## Run

```sh
pnpm dev                                   # build and open
pnpm --filter @carrel/desktop smoke        # start, check the shell renders, quit
```

## Projects and desks

![First start, a project on Mac, the same project on Windows at night](screenshot-projects.png)

On first start Carrel asks for a project name. Projects live in visible
folders, and a restart reopens the project and desk you left:

```
~/Carrel/<project>/
  project.json            id, name, desk order
  desks/<desk id>.json    name, viewport, sheets
  events.jsonl            every change, with its actor
~/.carrel/settings.json   the open project, and the open desk per project
```

The main process owns these files (`@carrel/core`'s `Workspace`); the renderer
asks over IPC and gets a summary back. The smoke check creates a project and a
desk in a temporary home, restarts, and checks they come back.

## The desk

![A marquee over two sheets; three selected with the selection bar; the Scale choices at night](screenshot-selection.png)

| Do | How |
| --- | --- |
| Add a blank sheet | Double-click the mat, or **+ Add**, Blank sheet |
| Move | Drag a sheet's label row; snap guides show near other sheets |
| Resize | Drag one of the eight handles of a single selected sheet |
| Select | Click a label; Shift-click to add; drag a marquee on the bare mat; ⌘A / Ctrl+A |
| Scale | **Scale** in the selection bar, then 100–30% |
| Pile | Select two or more, **Make a pile**: they stack at 30% under a "Pile · N" label. Drag the label to move the pile, click it to select it, **Spread out** to lay it out in a row |
| Delete | Delete or Backspace |
| Undo, redo | ⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Shift+Z or Ctrl+Y |
| Clear the selection | Esc, or click the bare mat |
| Pan | Two-finger scroll, Space-drag, or drag with the middle button; or click and drag on the map |
| Zoom (25–200%) | Pinch, ⌘/Ctrl-scroll, ⌘+ and ⌘− (Ctrl on Windows), or − and + on the pill |
| Actual size, fit all | ⌘0 or click the percentage; ⌘1 or **Fit** |
| Tidy up | **Tidy up** on the pill: rows in reading order, as wide as the screen; piles move whole. One undo step |

![Three sheets selected; Make a pile; the pile selected at night](screenshot-piles.png)

![At 100% with the map; zoomed out and panned; Fit at night](screenshot-view.png)

![Before and after Tidy up, Day and Night](screenshot-tidy.png)

The view (pan and zoom) is saved with each desk and comes back after a
restart; it isn't an event, since it doesn't change the desk. Only sheets
near the screen are mounted.

Each finished gesture is saved and logged as one event, and is one undo step.
Undo history lasts while the desk is open.

## Sources

![PDF, web page and video sheets with the Add menu; adding a link at night](screenshot-sources.png)

**+ Add** on the pill adds a book or paper (PDF), a web page or video link,
or a blank sheet. You can also drop PDFs or links on the desk, or paste a
link anywhere but a text field. A source becomes an item of the project and
a sheet on this desk; the sidebar counts them.

```
~/Carrel/<project>/items/<item id>/
  item.json           kind, title, who added it, and where the source is
  <file>.pdf          a stored book or paper, copied in
```

Web pages and videos are linked by URL and never downloaded. Until each
kind's viewer comes, a sheet shows the source's title and where it is.

![A PDF on its sheet at 60%, and at 100% at night](screenshot-pdf.png)

**PDFs** open inside their sheet with pdf.js: scroll over the sheet to read,
the label shows the page, and text can be selected. Only pages near the view
are drawn, at a resolution matched to the sheet's scale and the desk zoom.

![A live web page at 60%; at night, the snapshot it left](screenshot-web.png)

**Web pages** open when you click into their sheet. Only one page is live at
a time, and only while its whole sheet is in view with nothing over it; the
page zooms to the sheet's scale. Every other web sheet shows the snapshot the
page left when it stopped being live (Esc, a click elsewhere, a drag). The
snapshot is kept as `snapshot.png` beside the item. When a page loads, its
title replaces the name made from the link, unless you renamed it. Links
that open new windows go to your browser.

![A click on a web sheet hanging off the desk shows why it didn't open](screenshot-web-hint.png)

![A YouTube sheet waiting for its player, day and night](screenshot-video.png)

**YouTube videos** play on their sheet in YouTube's privacy-enhanced embed.
Nothing autoplays; a link's `t=` sets where it starts. The label shows the
current time, and the player's title replaces the name made from the link.
Starting one video pauses the others: one audio source at a time. The player
stays hidden until it answers, so if it can't load, the sheet says so instead
of showing an error page. Videos from other sites open like web pages.

The desk is served from `https://desk.carrel.app/`, intercepted inside the
app, because YouTube's embed refuses `file://` pages. Web pages on the desk
get their own session, apart from the desk's.

## Frames

- **Mac:** hidden inset title bar; the traffic lights sit over the sidebar,
  whose top and the top bar move the window.
- **Windows:** the app draws a title strip; the native minimize, maximize and
  close buttons sit on it (`titleBarOverlay`) and follow the theme.
- **Other platforms:** the system frame.

The theme follows the system's light or dark mode.

For screenshots, these environment variables pick what you'd see elsewhere:

| Variable | Does |
| --- | --- |
| `CARREL_FRAME=mac\|windows` | Draw that platform's frame (the traffic lights themselves only show on a Mac) |
| `CARREL_THEME=day\|night` | Force a theme |
| `CARREL_SHOT=file.png` | Save the page as a PNG and quit |
| `CARREL_HOME=folder` | Use `folder/Carrel` and `folder/.carrel` instead of your home folder |
