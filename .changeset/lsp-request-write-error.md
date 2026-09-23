---
"@reddb-io/redcode": patch
---

A language server that exits at startup no longer produces an unhandled EPIPE error when redcode sends it the first request.
