---
"@reddb-io/redcode": patch
---

At the end of a turn with an active goal in dual reasoning, System One now judges the goal and reviews the final response at the same time instead of one after the other, so the turn settles in the time of the slower request rather than the sum of both. If the goal continues, the review that was started is cancelled.
