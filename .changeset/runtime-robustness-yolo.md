---
"@reddb-io/redcode": minor
---

`--yolo` is its own mode again. `--auto` approves permission prompts that no rule denies and leaves the repository guard in place, so destructive Git commands such as `git reset`, `git stash` or a forced push are still refused. `--yolo` (also `--dangerously-skip-permissions`) does the same and lifts that guard for the session. Deny rules, secret protection, authentication and automatic worktrees apply in both modes. Both flags now explain this in `--help`, and a session in yolo mode shows `yolo` in the warning color in the prompt footer and a toast when it starts.

A turn whose agent sets no `steps` of its own is now bounded by `experimental.turn_steps` (default 400): the last step runs with tools off and asks for a report of what was done and what is left, and new input starts the count over. Set it to `false` to remove the ceiling. A V1 `turn_steps: { stop_at }` setting carries over.

A language server that exits at startup because its Node runtime rejects a flag in the inherited `NODE_OPTIONS` restarts once without that flag instead of staying broken.
