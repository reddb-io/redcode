---
"@reddb-io/redcode": patch
---

Add `redcode restart` as a shortcut for `redcode service restart`. Bound terminal shutdown requests so explicit restart and stop can reach process termination when the server is unresponsive, and let the TUI restart recover when terminal handoff fails.
