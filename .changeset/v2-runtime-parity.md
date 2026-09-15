---
"@reddb-io/redcode": minor
---

Bring the v2 session runner behind `redcode design` to parity with the legacy runtime. Retries now follow the legacy policy: at most 5, with exponential backoff and jitter, `retry-after` honoured, and no retry after a context overflow or once a local tool has run. The v2 runner also gains:

- the loop guard, which corrects a repeated identical tool call and then stops it, pausing an active goal with a `loop guard:` reason;
- the 10-minute tool deadline, which does not count time spent waiting on a person;
- live `session.status` busy, retry and idle events;
- the stall watchdog, which ends unattended turns after 10 minutes without output.

MCP tools in v2 are now registered as `<server>_<tool>`, the same key legacy uses, instead of `mcp_<server>_<tool>`. Permission rules or hooks that named v2 MCP tools with the `mcp_` prefix must drop it. Tool calls already in existing v2 transcripts keep their old names and are only replayed as history.
