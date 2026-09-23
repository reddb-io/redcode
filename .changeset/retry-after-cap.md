---
"@reddb-io/redcode": patch
---

Provider-requested retry waits (`retry-after`, `retry-after-ms`, and a router's `X-9Router-Retry-At`) are now capped at fifteen minutes, so a hostile or buggy header can no longer stall a session for hours or days.
