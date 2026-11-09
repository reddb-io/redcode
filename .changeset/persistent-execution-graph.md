---
"@reddb-io/redcode": patch
---

Expose a durable execution graph that connects parent and child sessions, recoverable jobs, shell executions, and persistent terminals while overlaying live running, waiting, and suspended state. Desktop and Web can inspect the live graph in a compact side panel and open child conversations directly; the TUI subagent inspector includes the same event-driven execution summary and remains compatible with older servers.
