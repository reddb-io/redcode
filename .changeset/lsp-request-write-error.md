---
"@reddb-io/redcode": patch
---

A language server that exits at startup no longer produces an unhandled EPIPE error. On Windows, redcode now also recovers Node language servers whose `NODE_OPTIONS` flag is rejected, restarting them without that flag.
