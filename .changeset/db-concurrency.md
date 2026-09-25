---
"@reddb-io/redcode": patch
---

Parallel `redcode acp` agents sharing one database no longer lose a turn to "Failed to execute statement": a write outside a transaction that finds another process holding the lock now waits and tries again, like transactions already did. When a statement does fail, the error names the statement and the SQLite code, for example "Failed to execute statement (INSERT, SQLITE_BUSY: database is locked)". Set `REDCODE_DB` per process to give an agent its own database.
