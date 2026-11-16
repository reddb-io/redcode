---
"@reddb-io/redcode": minor
---

Repair the Design cycle end to end and add the Design task ledger.

The generated tool schema advertised `null` for every optional field while the decoder rejects it, so `design_document` refused `{"id":null}` and `design_preview` refused `{"path":null}` — 30 and 16 times in a single session — and the agent never reached a created design's work root. Input schemas now state the decoder's contract: an optional field accepts an absent key, a genuinely nullable one keeps null.

`design_document create` accepts the brief, decisions, scenarios, targets, controls, presets, entry and tweaks an update records, so one call defines a design instead of being refused for excess properties (33 refusals for `notes` alone). A real note or addressed mark sent with a create now names the reason — a new design has no round to answer — instead of an excess-property error.

Admit each Design review note as a task in the existing ledger, keyed by design and note index so a retried delivery cannot duplicate it and earlier work is preserved. A task write failure is logged rather than blocking the review itself.

`plan_exit` names the task and field to fix instead of repeating one generic refusal eight times, and the quote it requires is the plan's own text. The Design review message, round continuation and playbook carry complete tool arguments.

Publish on the same document identity when a path matches an existing Design workspace, support review actions over LAN HTTP without `crypto.randomUUID`, and recover output-limited responses with an explicit incomplete error when repeated truncation makes no progress.
