---
"@reddb-io/redcode": patch
---

Preserve provider response bodies in session errors, show the provider's explanation when a response or compaction is blocked, and recognize Together/TGI context overflows so existing compaction recovery can handle them.

Sanitized session exports withhold provider response bodies while retaining the original diagnostics locally.
