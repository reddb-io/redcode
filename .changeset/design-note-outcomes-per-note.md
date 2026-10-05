---
"@reddb-io/redcode": patch
---

Record the outcomes of Design review notes one by one. One mistyped note id or one refused status used to void the whole `design_document` update, so every note of the round stayed open and approval stayed blocked. Each status is now judged on its own: the valid ones are recorded, and the result tells the agent how many were recorded, why each refused one was refused, and which notes still have no outcome, round by round, with the reviewer's words.

With dual reasoning, the System One review of those outcomes no longer receives every note and every job of the design. It is sent only the notes being recorded as resolved or partial, each with what the reviewer asked and what the cited verify saw of it, so it stops failing with "Semantic evaluation unavailable" once a design has a few rounds. A review that is unavailable or inconclusive records the status and reports it as unverified instead of leaving the note open; only a note the review contradicts is refused.

The verify report quotes each reviewer's note under what the verify saw of it, and the message that blocks approval names the `design_read` call that lists a round's notes with their text.
