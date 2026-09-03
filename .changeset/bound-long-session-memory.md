---
"@reddb-io/redcode": patch
---

Stop long sessions from growing without bound and being OOM-killed: turn diffs no longer embed a whole copy of every large file they touch, concurrent turn summaries collapse into one run instead of hydrating the session several times over, edit tool metadata carries diagnostics only for the files it touched, and the TUI mirrors a session's messages only once something asks for that session. Also documents installing and upgrading with mise.
