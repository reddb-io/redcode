---
"@reddb-io/redcode": patch
---

Release cancelled Desktop requests immediately, respect disk backpressure when capturing shell output, and bound terminal queues in both the server and Desktop so slow clients or rendering cannot grow memory without limit. Run local typechecks sequentially to avoid competing compiler memory peaks.
