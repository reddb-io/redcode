---
"@reddb-io/redcode": patch
---

Fix web startup over LAN HTTP by using the shared UUID fallback for browser client identity and observability run IDs when crypto.randomUUID is unavailable.
