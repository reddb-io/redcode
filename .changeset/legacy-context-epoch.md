---
"@reddb-io/redcode": patch
---

Keep the system prompt stable across the steps of a turn

The legacy session loop rebuilt the whole system prompt before every provider
call, so an edited AGENTS.md, a changed skill list or a new day rewrote the
cached prefix mid-turn. The loop now stores one Baseline System Context per
Context Epoch and reuses it verbatim; changes are admitted once as a
`<system_update>` message at the next safe boundary, and compaction or a revert
starts a new epoch.
