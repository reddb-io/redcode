---
"@reddb-io/redcode": patch
---

Answer prompts that land while the previous turn is finishing

A prompt that arrived after the running turn's last look at history but before
the session went idle was persisted and never answered. The session runner now
records work that arrives during a run and starts one more run before going
idle, so the trailing user message gets its reply. A cancel still drops that
pending work instead of restarting it.
