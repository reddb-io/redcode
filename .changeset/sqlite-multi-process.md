---
"@reddb-io/redcode": patch
---

Several Redcode processes on one database (TUIs, `redcode serve`, `redcode run` workers, the design server) no longer trip over each other.

- **Write transactions begin with the write lock.** Every transaction on the shared database now begins `IMMEDIATE`, so one that reads before it writes cannot fail with `SQLITE_BUSY_SNAPSHOT` when another process commits in between — a failure the busy timeout never waited out. A transaction that finds the lock held past the timeout is begun again, whole, a bounded number of times with jittered delays.
- **Migrations are safe to run from two processes at once.** Schema creation and each migration take the write lock before deciding what to do and re-check the journal under it, so the second process waits and then no-ops instead of failing on a table or column the first already created.
- **Session updates are transactional.** Every change to a session writes its whole row back, `metadata` (spend, goal status, compaction state) included; the read and the write now run inside one transaction, so a title change or a `touch` in one process can no longer overwrite the spend or goal pause another process committed in between. In-memory listeners hear of a change only once it has committed.
- **Lock contention surfaces sooner, migrations wait longer.** A statement waits 1 s (was 5 s) for another process's lock before the transaction is retried, so a TUI stuck behind another writer sees the error after about 8 s instead of hanging for over half a minute; migrations, which may wait on a long table rebuild in another process, retry for about ten minutes and log each wait.
- **The database is closed on the way out.** The CLI, the TUI server thread and `redcode serve` (on Ctrl-C, and on SIGTERM where the platform delivers it — Windows does not) dispose the runtime — with a bound, so a stuck subprocess cannot keep the process alive — running `PRAGMA optimize` and letting SQLite fold the WAL back into the file.
