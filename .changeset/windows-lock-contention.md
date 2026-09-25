---
"@reddb-io/redcode": patch
---

On Windows, cross-process file locks (config and plugin updates, diagnostic log rotation, TUI state, package installs) no longer fail with `EPERM`, `EBUSY` or `ENOTEMPTY` when another process is checking the same lock while it is released; the waiter retries and the owner finishes removing the lock instead of leaving it held until it goes stale.
