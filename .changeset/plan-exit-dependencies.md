---
"@reddb-io/redcode": patch
---

Fix plan approval failing after the user approves: a stored plan revision may carry task dependencies as an explicit null (a model's omitted array survives the round-trip), and the todo admission rejected it with `Invalid task update: Expected array` after the approval had already been given. The mapping now omits the key entirely, and a focused regression test locks the contract (omission and empty array accepted; null and an explicit undefined key rejected).
