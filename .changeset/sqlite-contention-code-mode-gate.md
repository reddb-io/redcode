---
"@reddb-io/redcode": minor
---

Keep several TUIs, `serve`, `run` workers and the design app working on one shared database: write transactions take the write lock as they begin and retry whole with jittered backoff when another process holds it, migrations run under the write lock, the WAL switch tolerates a concurrent opener, and a failed statement names its kind and SQLite code.

Turn Code Mode off by default and advertise tools directly again. Set `experimental.code_mode.enabled` to `"on"` to call tools through `execute`, with each program limited to 50 tool calls, 120 seconds not counting permission prompts, and 1 MB of output (`max_tool_calls`, `timeout_ms`, `max_output_bytes`).
