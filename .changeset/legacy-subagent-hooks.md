---
"@reddb-io/redcode": patch
---

The legacy runtime now runs the `SubagentStart` and `SubagentStop` hooks for subagents, as the V2 runtime does. Context a `SubagentStart` hook returns is added to the subagent's brief. A `SubagentStop` hook that blocks sends its reason back to the subagent once.
