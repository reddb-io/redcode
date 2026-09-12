---
"@reddb-io/redcode": patch
---

Design review feedback now reaches the agent as one bounded `<design-review>` message: the user's note, the selected element's label and selector, selected or element text, and the scenario parameters are separate labelled fields instead of one fused blob, the page-text snapshot stays out of the message and is readable on demand with `design_read` section `snapshot`, and the TUI and `redcode design` terminal show the review as a compact list of notes with attachment chips instead of the raw text.
