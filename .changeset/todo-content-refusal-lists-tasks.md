---
"@reddb-io/redcode": minor
---

The `todowrite` refusal for an update that names neither `id` nor `content` now lists the existing tasks with their ids, revisions and titles, so a model that sends an evidence-only item can resend the exact update instead of retrying the same malformed shape.
