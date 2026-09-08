---
"@reddb-io/redcode": patch
---

Release TUI listeners on unmount, bound inactive transcript caches and evict deleted sessions, and recover transcripts and pending interactions only after the event stream connects. Fence delayed navigation and list responses so they cannot overwrite the current workspace or restore deleted sessions. Add `/goal-budget`, accurate resume status, approved Plan-to-Build handoffs, and a discoverable entry for the separate Design workspace.
