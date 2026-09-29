---
"@reddb-io/redcode": patch
---

`"worktree": { "location": "tmp" }` now also places the worktrees created from `/worktrees` or `redcode worktrees create` under `<tmpdir>/redcode-worktrees/<repository>-<hash>/`, as it already did for the worktree prepared when Build starts; a server started with `--tmp` or `REDCODE_WORKTREE_LOCATION=tmp` does the same. A new session worktree takes the next free directory name from the worktree service, and its branch keeps that name unless a branch of that name already exists.
