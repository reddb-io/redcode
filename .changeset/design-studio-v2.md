---
"@reddb-io/redcode": minor
---

Move Design mode to SessionV2 with durable review feedback, immutable revisions and approval packages, a shared embedded/browser review surface, isolated React/Solid previews, and design-system evidence.

Add canonical MCP and plugin image-tool registration, local versioned assets, editable SVG-to-GIF exports, accessibility/scenario checks, and comparison with the approved design. Preserve diagram whiteboards and reconcile the design-owned plan section without overwriting manual work.

Remove Design from V1 agents, tool registration and HTTP routing. Existing V1 design state is not migrated. New reviews use `/api/session/:sessionID/design/review`; the TUI's `/design` entry guides users to the dedicated `redcode design` terminal.
