---
"@reddb-io/redcode": patch
---

Separate Codex and Claude process protocols, event normalization and thread ownership behind capability-aware runtime adapters. Codex sessions on the same configured provider instance now reuse one generation-fenced app-server process while retaining isolated threads, permissions, interruption, memory attribution and recovery behavior. Provider instances give each Codex or Claude account its own executable, account home and credential revision; existing driver configuration migrates to compatible default instances, while the Desktop can create and select additional isolated instances. A configurable idle reaper keeps an unowned Codex runtime warm for fast sequential sessions, reports its memory while idle, unloads it after the selected interval and immediately evicts stale generations when account configuration changes.
