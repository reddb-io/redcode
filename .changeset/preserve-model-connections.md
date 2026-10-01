---
"@reddb-io/redcode": patch
---

Keep the connection selected in S2 setup and sessions when another account becomes active. Router models resolve from that connection's persisted catalog and endpoint; missing credentials or models produce an explicit error instead of switching accounts. Native compaction checkpoints cannot be reused across saved connections.

Show HTTP status, duration and response bytes on OpenAI-compatible discovery errors, record router catalog diagnostics, and distinguish a successful catalog check from a generation test. Expand mandatory CI contracts for model selection, session persistence, goal recovery, monitors and MCP authentication/lifecycle.
