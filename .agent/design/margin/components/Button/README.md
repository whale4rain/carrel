# Button

Buttons come in four kinds, and only one ink button per view.

- **Ink**: `ink` fill, `paper` text. The one main action: Continue, Send, Accept.
- **Outline**: 1px `graphite` border, `ink` text. Secondary actions.
- **Point**: `highlight` fill, `highlight-ink` text, mono label. Only for actions that start pointing ("Point with that.").
- **Quiet**: no border, `ink-muted` text. Opt-outs and low-stakes choices ("Just tell me").
- All: 36px high (44px on touch), `radius-control`, `label` type, a 2px `focus` ring with 2px offset.
- Never `pencil` buttons: the agent proposes, it doesn't own controls.

The consumer provides the label and handler.
