# Hands

Hands make authorship visible: your ink, the agent's pencil, and the step where pencil becomes ink.

- Your hand: `body` style in `ink`, upright `font-ui`.
- The agent's hand: `marginalia` style in `pencil`, italic `font-read`. Two differences, so the hands never rely on color alone.
- In a conversation, the agent's long answers use `font-read` upright in `ink`, beside its seat marker, so they stay comfortable to read. Pencil is kept for its marginalia, suggestions and direct questions ("Your turn").
- A proposal: `pencil-wash` ground, 1px dashed `pencil` border, `radius-control`, a "SUGGEST" tag. Its text is the text that will land, in `font-ui`, still `pencil`.
- Accept (Tab) inks it: the outline fades and the text turns `ink` over 240 ms. Its *that.* chips stay attached. Dismiss (Esc) removes it.
- Accepted text keeps a quiet record of origin, visible on hover ("from the agent, accepted 14 Oct"), never inline.

The consumer provides the proposed text, its sources and the accept and dismiss handlers.
