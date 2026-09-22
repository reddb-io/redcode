# Local diagnostic logs

`redcode debug logs --path` prints only the current diagnostic file path. `redcode debug logs --open` opens that file with the operating system's file handler. It reports immediate launcher failures without waiting for or closing the editor.

The CLI, TUI and local server share `~/.red/code/data/log/redcode.log`. Existing adoption of the older `~/.red/redcode` home is preserved; use the discovery command instead of assuming a spelling. `REDCODE_TEST_HOME` changes the home for isolated testing, not normal installation.

Each file is limited to 10 MiB. Rotation keeps the current file and four numbered archives (`.1` newest through `.4` oldest), at most 50 MiB in total. Rotation runs while writing, not only at startup. Independent processes coordinate with a file lock and reopen each batch; oversized entries are truncated on UTF-8 boundaries. An oversized pre-upgrade log is trimmed to its most recent bounded tail. New directories/files use private permissions where supported. A failed write warns once on stderr and does not stop the application.

Existing structured fields, log levels and run IDs are retained. Common credential fields, authorization values and credential-bearing URLs are redacted. This is not a guarantee that arbitrary free-form content contains no private data: inspect logs before sharing them. No extra prompt, request-body or environment dump is introduced. CLI errors caught by the top-level handler are written before exit; SIGKILL, power loss and failures before initialization cannot be captured reliably.

Electron desktop logs keep their existing `userData/logs/<run>/` location and electron-log's 5 MiB rotation threshold. After taking the single-instance lock, desktop prunes old run directories at startup and every minute: at most five retained runs, a 200 MiB combined retention budget, and seven days of history. The active run is never deleted, even if it alone exceeds the budget. Debug exports include current RedCode logs and the older compatible locations.

Separate opt-in `boot-*.log` traces, Chromium Crashpad dumps and exported debug ZIPs are not governed by the CLI's five-file rotation policy. Chromium network capture retains its existing 20 MiB cap. These diagnostic artifacts may contain sensitive material and should not be shared without review.
