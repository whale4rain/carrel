# AgentPanel

The agent panel holds the project's ongoing thread and opens over any desk with ⌘J (Ctrl+J on Windows).

- 380px wide, docked right, `paper` with `shadow-lift`. Header: the agent's seat marker, the thread name, "ongoing since" date, and a Threads menu for side threads.
- Linear chat: your messages right-aligned on `paper-2`; the agent's answers left, `font-read` upright in `ink`. Direct questions to you ("Your turn") and suggestions use `pencil`.
- Each answer opens with one folded steps line in `position` style ("▸ Read 2 sources"). Earlier days fold into a single divider line.
- Hovering a turn shows *that.* this turn (`highlight`) and Add to note (outline).
- The composer at the foot shows what you are pointing at, taken from your current selection on the desk.

The consumer provides the thread's turns, the current selection and the send handler.
