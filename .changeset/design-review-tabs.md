---
"@reddb-io/redcode": patch
---

Design review opens at most one browser tab per review. Publishing a revision no longer opens a new tab when a review page for the session is already connected (it live-reloads instead), rapid publishes open one tab, and a closed tab is reopened only after a short debounce. `redcode design` and the TUI's Open Design review follow the same rule. Test suites can no longer launch a real browser.
