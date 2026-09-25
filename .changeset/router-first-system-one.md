---
"@reddb-io/redcode": patch
---

A connected RedRouter now decides which System One evaluators it offers: setup, the web settings and the CLI list one option per model in the router's `/v1/models/systemone` catalog, named after the upstream that serves it, including models reached through another account (for example `RedRouter · OpenCode Zen (via OpenCode Go) · JEV 1.13`). The built-in System One offers now describe direct providers only, and a RedRouter connected under a direct provider's id is no longer offered as that provider.
