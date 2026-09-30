---
"@reddb-io/redcode": patch
---

The S1 evaluator step of the reasoning setup now lists only services that already have an active connection, like the S2 model step. It no longer asks for an API base URL or key inline for services that are not connected.
