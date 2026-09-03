---
"@reddb-io/redcode": patch
---

Recover from stuck states without the user having to diagnose them: a worker thread that throws or dies now fails the waiting call instead of freezing the UI, a lock whose owning process is gone is taken over immediately rather than after a minute, startup no longer waits forever on a stalled home directory, a piped stdin that never closes, a hung git, or an unbounded musl probe, and language servers close documents past an open-file cap instead of holding every file the session ever touched.
