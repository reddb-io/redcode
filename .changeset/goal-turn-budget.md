---
"@reddb-io/redcode": patch
---

Count goal turns as judged turns and never leave a goal active on an idle session

A goal turn is now one full agent turn ending in a judge cycle. Tool round-trips
inside a turn and provider retries under it no longer spend the budget, so the
default of 20 turns is no longer exhausted by a turn that reads fifteen files; a
turn parked on background work spends nothing until its report is judged. The
goal block, the continuation, the judge prompt, the budget dialog and the toasts
all say "turns".

A `/goal-budget` or `/goal-resume` landing while the judge decides is no longer
lost: the decision is taken again on the fresh record, and a second loss pauses
the goal with a reason. The step ceiling and the stall watchdog now pause the
goal with their reason instead of leaving it active with nothing recorded.
Evidence for the judge is scoped to the current turn, and gate results survive
the cut ahead of tool output.
