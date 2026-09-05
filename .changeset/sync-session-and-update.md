---
"@reddb-io/redcode": patch
"@reddb-io/redcode-core": patch
---

Ported from upstream: session, provider list, database and apply-patch fixes

`/connect` shows the providers that are actually authenticated; session request headers are restored after compaction and the parent session header is sent; a database whose legacy migration history is missing is recovered instead of refusing to start; `apply_patch` no longer emits an empty move path.
