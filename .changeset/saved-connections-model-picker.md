---
"@reddb-io/redcode": patch
---

Fix /connect getting stuck when selecting a saved provider connection. Active connections now open their model picker, and switching credentials waits for the refreshed provider and model catalog before continuing.
