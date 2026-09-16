---
"@reddb-io/redcode": patch
---

Several Redcode processes on one database (TUIs, `redcode serve`, `redcode run` workers, the design server) no longer trip over each other.

- **Write transactions begin with the write lock.** Every transaction on the shared database now begins `IMMEDIATE`, so one that reads before it writes cannot fail with `SQLITE_BUSY_SNAPSHOT` when another process commits in between — a failure the busy timeout never waited out. A transaction that finds the lock held past the timeout is begun again, whole, a bounded number of times with jittered delays.
- **Migrations are safe to run from two processes at once.** Schema creation and each migration take the write lock before deciding what to do and re-check the journal under it, so the second process waits and then no-ops instead of failing on a table or column the first already created.
- **Session metadata updates are transactional.** Spend, goal status and compaction state share `metadata`; the read-modify-write now runs inside one transaction, so one process can no longer overwrite another's goal pause or spend from a stale read.
- **The database is closed on the way out.** The CLI, the TUI server thread and `redcode serve` (on SIGINT/SIGTERM) dispose the runtime — with a bound, so a stuck subprocess cannot keep the process alive — running `PRAGMA optimize` and letting SQLite fold the WAL back into the file.
