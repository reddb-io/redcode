---
"@reddb-io/redcode": minor
"@reddb-io/redcode-schema": minor
---

Design mode keeps track of feedback rounds and verifies each round in one job.

- **Rounds and note statuses.** Review notes sent from the browser are recorded on the design document: notes arriving before a revision answers them form one round, and the first `design_preview` after them closes it. Every note carries a durable status (`open`, `resolved`, `partial`, `unresolved`, `accepted`) that the agent records with `design_document update notes: [{feedback, index, status, reason?, evidence: {job}}]`; the evidence copies the verify job's capture and findings for that note.
- **One verify per round.** `design_export` gains `format: "verify"` (optional `round`, latest by default). In one job it renders the new revision and, for each note of the round, locates its element by `data-design-id`, selector or XPath in its variant, parameters and screen, captures a focused crop on the revision the note was taken on and on the new one, runs the scenarios of that screen and axe and layout checks scoped to the element's container, and reports one line per note, including "element not found" when it disappeared. Only a new serious or critical violation blocks a note; what the container already had before the fix is reported as pre-existing. Every note of the round is verified, each within its own time budget, and finished notes are kept even when a later one times out. `design_jobs` prints the per-note lines with the capture paths to cite and names notes that joined the round after the verify ran.
- **Review page.** The conversation feed shows a verify's verdict per note (pass, findings, missing) with a link to the report and its captures; a "Feedback rounds" section lists every note with its status and reason, and a partial or unresolved note goes into the next round with one click.
- Both runtimes (TUI and `redcode design`) and both conversation feeds carry the new entries. Restoring an older revision keeps the review's rounds and statuses. Existing documents without rounds decode unchanged.
