---
"@reddb-io/redcode": patch
---

The V2 runtime (`redcode design`) records latency and output speed per step, the way the legacy runtime does.

- **What is recorded.** Each provider step records its request start (per HTTP attempt, so a rate-limit backoff inside the provider client is excluded), and its first token, first visible token and last token as they arrive. It also records output and reasoning token counts, the reasoning that streamed, and whether the tokens arrived as a burst. Durations use a monotonic clock. Tool runs, hooks and snapshots fall outside the generation window.
- **Where it is stored.** The step's settlement event and the projected assistant message carry it as `timing`. Nothing displays it for V2 sessions yet: the TUI sidebar and the app read legacy messages.
- **When it is written.** Only when the step settles. Unlike the legacy runtime, a V2 step has no live first token while it streams.
- **Older sessions** without `timing` load as before.
