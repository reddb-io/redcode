---
"@reddb-io/redcode": minor
"@reddb-io/redcode-tui": minor
"@reddb-io/redcode-app": minor
"@reddb-io/redcode-schema": patch
"@reddb-io/redcode-sdk": patch
---

Latency and output speed on the panel

Every assistant message now records when its first streamed chunk arrived (`time.first`). The TUI footer shows the last reply's latency and its output rate next to context and cost — `1.2s · 84 tk/s` — and the app shows both in the context tooltip and the context tab. Speed counts output plus reasoning tokens from the first chunk to completion; latency is the wait from the request to that first chunk. Messages from before this release show neither rather than a guess.
