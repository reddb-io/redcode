---
"@reddb-io/redcode": patch
---

Subscribe to global events before announcing the SSE connection, preventing session updates from falling between recovery snapshots and the live event stream. Release the subscription when the request closes, including abandoned response bodies.
