---
"@reddb-io/redcode": patch
---

The V2 runtime (`redcode design`) records latency and output speed the way the legacy runtime does.

- **Step timing.** Each provider step records its request start, first token, first visible token and last token, per attempt and with a monotonic clock. The step's settlement event and the assistant message carry them as `timing`, which excludes tool runs, hooks and snapshots from the generation window. Older sessions without it load as before.
- **Reasoning counted apart from output.** Usage where reasoning exceeds output no longer reports zero output tokens.
