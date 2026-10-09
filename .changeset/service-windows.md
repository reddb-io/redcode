---
"@reddb-io/redcode": patch
---

On Windows the background service no longer flashes empty terminal windows: language servers, their installers and archive extraction, the design app and its git and tar helpers, worktree git and `gh` checks, and the persistent terminal daemon now start without a console window. Redskilled status reads keep one adapter per project alive while they are polled instead of starting a new `red-skills-redskilled acp` process on every read, wait 30 seconds before retrying an adapter that failed or is not installed, and the TUI polls Redskilled workers only while the Workers tab or page is open.
