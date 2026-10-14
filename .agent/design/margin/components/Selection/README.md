# Selection

Selection is how sheets are moved, resized and acted on in the free layout.

- A selected sheet gets a 1.5px `ink` outline and eight square handles: 8px, `paper` fill, 1.5px `ink` border. While resizing, a size label in `position` style sits under the bottom-right handle.
- A sheet being dragged takes `shadow-lift` and rises above the others. Snap guides are 1px dashed `margin-line`, visible only while dragging.
- The selection bar sits just under the selection: an `ink` bar with `paper` text. It shows only actions that apply: Focus (one sheet), Compare (two or more), Make a pile, Scale, and *that.* in `highlight`. The most likely action is the filled `paper` button.
- Esc clears the selection. Nothing about selection changes what a sheet contains.

The consumer provides the selected sheets and the action handlers.
