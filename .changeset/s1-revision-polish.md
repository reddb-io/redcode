---
"@reddb-io/redcode": patch
---

Show an answer revised after System One's review as one reply in the TUI: the final answer and its thought come first, followed by a muted "↻ revised after S1 review (issue) · show original" note that opens the superseded answer on demand. The S1 marker in the prompt footer now warns only when S1 is not set up, unavailable or failing, or left an issue unresolved after its repair, and the S1 dialog says why. System One's `unsupported` check now targets claims of performed or verified work, so greetings and statements of readiness are no longer flagged.
