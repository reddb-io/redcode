---
"@reddb-io/redcode": patch
---

Remote MCP servers that rotate refresh tokens no longer lose their sign-in when several connections refresh at once. Concurrent refreshes of the same token now share one request, and a connection whose stale token was rejected no longer deletes the newer tokens another connection or process already stored.
