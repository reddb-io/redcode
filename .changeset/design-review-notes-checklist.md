---
"@reddb-io/redcode": patch
---

Design review notes are now a checklist the agent cannot silently skip. The agent marks each note it changed with `design_document update addressed`, and `design_preview` refuses to publish an answer to a feedback round while a note of that round has neither a mark nor an outcome, quoting those notes. Publishing a preset, tweak or restore from the review page no longer closes the open round; only the agent's `design_preview` answers it. Publish, verify and `design_document` results end with what each round still waits for, and the Design context keeps a pointer to the round's open notes after compaction.
