# Seat

A seat marker shows who is at the desk, person or agent, and where each one is looking.

- Round (`radius-seat`), 32px, on the mat with a 2px `mat` ring so overlapping seats stay separate.
- You: `ink` fill. Other people: `paper` fill, initials in `ink`. An agent: `paper` fill, a 2px `pencil` ring and an italic `font-read` letter, so agents never look like people.
- Hover or the line beside the seats says where each one is, with a position in `position` style.
- Each seat's hand keeps its own ink on a shared desk; other people's notes carry their initials on hover.

The consumer provides the people, the agents and their current positions. Mia is a placeholder.
