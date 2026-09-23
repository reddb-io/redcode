---
"@reddb-io/redcode": patch
---

`--verbose` now explains prompt cache misses. Each provider request logs a `prompt.cache` entry that compares it with the session's previous request: `initial`, `stable`, `append-only`, or `changed:<component>` naming the first model setting, tool, system part or message that changed. Only hashes are kept, for at most 100 sessions, and nothing is computed without `--verbose`.
