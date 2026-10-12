---
"@reddb-io/redcode": patch
---

Preserve the active Git worktree's path, branch and changed-file counts in summary and native compaction checkpoints. Discover from the session directory so linked worktrees never use the main checkout's status, and omit the snapshot outside Git repositories.
