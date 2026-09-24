---
"@reddb-io/redcode": patch
---

Plan approval no longer gets stuck in Plan when S1 disagrees. The S1 plan review is now advisory: `plan_exit` always asks "Execute plan …?", shows the S1 verdict with the reason behind each flagged check, and the user's Yes reaches Build whatever the verdict. When S1 flags the same checks across revisions, the result tells the model the user decides instead of asking it to resubmit. Long sessions no longer fail the review by construction: it reads the first and most recent requests within its budget, and truncated evidence no longer counts as a plan gap.
