---
"@reddb-io/redcode-schema": minor
"@reddb-io/redcode-core": minor
"@reddb-io/redcode": minor
"@reddb-io/redcode-tui": minor
---

Session monitors can now wait on an HTTP endpoint, a file or a process natively, without a shell and on every platform: call the `monitor` tool with `action: "probe"` and an `http` probe (status, `json_path` with `equals`/`contains`/`regex`, same-host redirects only, 1 MB and 10 s bounds, `{env:NAME}` header values that ask a separate `env` permission per variable and host and are never shown), a `file` probe (`exists`, `missing` or `changed`, with `min_size`) or a `process` probe (`running` or `exited`, by exact executable `name`, by command line with `match: "cmdline"`, or by `pid`, among the current user's processes). Regular expressions run in a worker with a hard timeout, so a catastrophic pattern cannot freeze the runtime. An http probe asks the `webfetch` permission, a file probe asks `read` and `external_directory` (symlink targets included), and a process probe needs none; a poll longer than 10 minutes is still approved every time. Command polls gain `success_regex`, `failure_regex` and `until: "changed"`. Poll checks are now spread by a small random jitter (`jitter: false` keeps exact intervals), the last check always starts before the deadline, and a finished monitor's resume message states what matched. The sleep-polling guard offers the matching probe for `curl -f`, `test -f`/`[ -e ]` and `pgrep` loops, and `/monitors` shows probe monitors with their schedule.
