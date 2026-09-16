---
"@reddb-io/redcode": minor
---

Add a global `--verbose` flag (also `REDCODE_VERBOSE=1`). It traces the boot to stderr, one line per phase with elapsed and delta times — config files, models catalog origin and age, providers found, plugins, MCP servers with connection time and status, LSP servers, server address, instance, TUI mount and first render — and stops at the first rendered frame with `boot complete in N ms; log at <path>`. Under the TUI the trace continues in `<data>/log/boot-<timestamp>.log` and the footer shows where; `redcode run --verbose` prints everything to stderr. After boot it traces activity at DEBUG with a `verbose=<event>` tag: provider request/response/retry (model, tokens, duration; never bodies or keys), tool start/end (duration, output size), permission ask/reply, compaction decisions, guard trips, inbox promotions, monitors and learned model limits. `redcode debug startup` prints the same phases.
