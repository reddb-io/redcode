---
"@reddb-io/redcode": minor
---

The V2 session runtime can now run subagents. Its `task` tool starts a child session in the parent's location, keeps the parent's permission denies, and runs the child on its own runner until it finishes. The brief is reviewed before launch and the result after it, with one repair round, as in the legacy runtime. A child the stop-loss stops reports why. The `models` tool is also available in V2, and `SubagentStart` and `SubagentStop` hooks now run.
