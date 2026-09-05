---
"@reddb-io/redcode": minor
"@reddb-io/redcode-core": minor
---

Real fan-out: every subtask on a message runs, together; background subagents on by default, capped per session

A message carrying several subtasks used to run only the last one — the assistant message the first subtask left behind hid the rest. Now all of them run, `experimental.subtask_concurrency` at a time (default 4), and their results land in the order they were asked. Background subagents no longer need `REDCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`; set it to `false` to turn them off. One session may have `experimental.background_subagents_max` (default 4) running at once; past that the task tool refuses and tells the model to wait or run the task inline. Cancelling the run — Ctrl+C, `/goal-drop` — still cancels every child.
