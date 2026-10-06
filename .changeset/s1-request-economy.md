---
"@reddb-io/redcode": patch
---

Fewer System One round trips. A todowrite update now reviews all its changed tasks in one System One request per kind (quality or completion), split into parallel requests of at most ten tasks only when larger, instead of one sequential request per task. Each task still gets its own verdict, and every unverified note or refusal now names the task it concerns. Creating a design no longer waits on design system identification before classifying the target: the `design_target` request runs alongside it, and only when the prompt classification has not already read the target. The design system warm-up is now reused when the agent names the application it resolved, instead of asking System One again. The feedback round trailer asks the agent to record every note's outcome in one update, so a round costs one note review instead of one per note.
