---
"@reddb-io/redcode": minor
---

The composer panel has a new System tab after Terminals. It shows the Redcode version, the runtime and platform, the server's process, uptime and memory, and its URLs; the database, which is a local SQLite file with its path, size, write-ahead log and row counts, or a remote database by protocol and host only, never a token; and where the config, data, state, cache, log and temporary files live. It refreshes while it is open, and `r` reads it again. The server gains a `GET /api/system` endpoint for it.
