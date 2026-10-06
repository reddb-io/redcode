---
"@reddb-io/redcode": patch
---

Design no longer stops for good while review notes still lack outcomes. When the agent goes idle with notes of a round still open, it gets one continuation per round that lists the notes and what is still missing (addressed marks, the publish, a verify, the outcomes). It is skipped while a verify runs, after an interrupted turn, and for ended designs. Send & end with notes no longer deadlocks the review. The review stays open for that round (`endRequested` on the design) and ends by itself once every note has an outcome; the agent is told it ends after the round. A plain end works as before. The Design task reminder now says that tasks cover setup, approval and anti-slop findings, and that a design_preview publish alone proves no note outcome.
