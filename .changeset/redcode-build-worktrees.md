---
"@reddb-io/redcode": patch
---

Restore the session's project directory, Git worktree, and branch in the TUI sidebar. Prepare a dedicated Git worktree when Build starts, before the first prompt or continued model step, while preserving changes in the original checkout.
