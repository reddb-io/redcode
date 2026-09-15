---
"@reddb-io/redcode": minor
---

Design mode detects the project's design system and offers to adopt it. When no `design.system` is configured, `redcode design`, and `design_document` create or refresh in the TUI and V2 sessions, ask once "Use detected design system?" with the detected component roots, global stylesheet, Tailwind version and config, framework and tsconfig aliases, each with its confidence. Monorepos target the application package. Detection only reads files and never runs project code. Yes writes the `design` section into the project's config and keeps its other keys, comments and indentation, then generates `.red/DESIGN.md`. No is remembered for the project in user state, and Edit later asks again after a day. The new `design.browser` setting chooses the browser for review pages; `REDCODE_DESIGN_BROWSER` still wins. The new `design.application` setting names the package a design targets by default.
