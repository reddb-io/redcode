---
"@reddb-io/redcode": minor
---

Redcode now manages the repository's local worktrees. `/worktrees` lists them in compact rows (`⎇ .red/worktrees/x  ⑂ x  1.2G  dirty·3d`) with their size, pending changes, merge state, recent activity and linked sessions. From there you can move the session into a worktree, remove one, or clean the merged ones, and you see the space freed. The same actions are available as `redcode worktrees list [--json]`, `redcode worktrees clean [--merged] [--stale <days>] [--dry-run] [--yes]` and `redcode worktrees remove <path|branch> [--force] [--delete-branch]`, and through new experimental HTTP routes. Removal never discards uncommitted work without an explicit confirmation or `--force`, and it never touches the primary checkout or the worktree of an active session. Clean only removes worktrees with no changes and prunes stale registrations.
