---
"@reddb-io/redcode": patch
---

Improve MCP reliability with bounded retries for transient remote connection and catalog failures, actionable HTTP and process-exit diagnostics, and graceful legacy session termination. Authentication failures, local process startup, and tool execution are not retried by the transient recovery policy.
