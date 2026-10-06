---
"@reddb-io/redcode": patch
---

In dual reasoning, a change request typed in the chat during a design review is now tracked like a note from the review page. For example, "make the header bigger and fix the colors" becomes a whole-page note with the user's own words. The note goes into the open feedback round, or opens a new one, and is marked as coming from a chat message (`source: "message"` on the note). It blocks the publish, approval and end of the review the same way other notes do, and it must get an outcome. System One reads this from the prompt classification that already runs, so there is no extra request and nothing waits for it. Questions, approvals, requests for a new design, prompts sent by the review page or the harness, and messages flagged as containing restricted content never become notes. A retried message never becomes a second note. Single reasoning works as before.
