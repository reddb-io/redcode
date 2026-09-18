---
"@reddb-io/redcode": patch
---

`todowrite` updates addressed by `id` no longer require the revision: an update without one applies against the stored revision, so a batch where one item omits it is no longer refused outright. A supplied revision that no longer matches is still refused, and the refusal now quotes the current revision with the exact update to resend.