---
"@reddb-io/redcode": minor
---

Design mode enforces the fix-round gate.

- **Status gate.** `design_document update notes` refuses `resolved` unless it cites a completed verify job on the current revision that found the note's element with no blocking finding; `partial` needs such a job and a reason; `unresolved` and `accepted` need a reason. A refusal lists the recent verify jobs, so the agent acts on it instead of resending, the way the todo evidence gate names callIDs.
- **No approval or ending with open notes.** `design_exit` (both runtimes), the approval routes and the review page's "Send & end" are refused while any feedback round still has notes without a recorded status (listed per round); unresolved or accepted with a reason are allowed. The page hides "Send & end" and says why until the rounds are recorded, and a refused "Send & end" keeps the draft and retries as a plain send.
- **The reviewer can close a note by hand.** In the review page's rounds panel each open note can be recorded as accepted or unresolved with a reason, and the Approve dialog lists the notes the agent declined or left unresolved (with their reasons) and offers, when notes are still open, to record them as accepted by the reviewer and approve. Statuses recorded this way carry `by: "reviewer"`; the agent's tools cannot record as the reviewer, and the reviewer cannot record `resolved` or `partial`.
- **The round rule in the message and the prompts.** Every `<design-review>` with notes ends with the rule: fix everything in this round, publish one revision, run one verify for the round, then record each note's status with evidence, naming the message's note ids. The Design instructions replace the per-fix "verified only after an audit" sentence with the round rule, and the screen playbook gains a "Feedback round" step (collect → fix all → publish → one verify → statuses → summarise and ask before another round).
