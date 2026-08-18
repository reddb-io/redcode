---
"opencode": minor
---

Add a responsive two-column sidebar. Narrow terminals and the overlay layout keep the existing single-column surface. Wide terminals gain a Session column for Context, Todo, and modified files, plus a Project column for MCP and LSP, with the title and footer spanning the full sidebar width. The existing `sidebar_content` slot stays compatible; new Project-scoped surfaces register via the `sidebar_project` slot.
