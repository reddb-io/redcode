---
"@reddb-io/redcode": patch
---

Stream remote desktop browser traffic over a binary WebSocket when the server supports it. Fall back to the existing RPC transport on older servers and when an intermediary blocks the WebSocket upgrade. Reconnect with a fresh ticket and fail interrupted streams without replaying their bytes.
