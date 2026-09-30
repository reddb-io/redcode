---
"@reddb-io/redcode": patch
---

The S1 indicator in the prompt footer now says what happened instead of "S1 needs attention", which read like something was down. It shows "S1 unavailable" (in the warning colour) only when System One could not be reached, and "S1 unsure" or "S1 flagged answer" (in the informational colour) when it answered without a confident reading or found a problem with the last answer. Click it or run `/intelligence` for the details.
