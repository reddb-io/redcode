---
"@reddb-io/redcode": patch
---

Language servers that exit at startup (for example when their Node rejects a `NODE_OPTIONS` flag) no longer surface an unhandled `EPIPE` from the client's first write; the restart without the rejected flag proceeds as intended.
