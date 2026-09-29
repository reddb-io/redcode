---
"@reddb-io/redcode": minor
---

Restore the /goal loop on the V2 runtime: an active goal continues through a durable synthetic prompt after the agent stops, until goal_complete verifies it or it is blocked, paused, out of budget, interrupted or stops making progress. With dual reasoning, System One judges each stop as progressing, stalled or blocked and never completes a goal itself. Subagents receive the parent's goal, and the parent waits while background subagents run.

Restore per-prompt System One classification with bounded session context. It feeds the Design target, task priority and a skill shortlist, and never blocks a prompt. With dual reasoning, System One also reviews the final response: an established issue gets one repair pass, and an unresolved or unavailable review leaves a visible note instead of approving the answer silently.
