---
"@reddb-io/redcode": patch
---

Keep project environment operations from failing on Windows when concurrent status reads briefly block an atomic result-file replacement. Retry only the same bounded file replacement, without replaying commands, and report scrubbed persistence errors if saving still fails.
