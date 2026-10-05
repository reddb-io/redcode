---
"@reddb-io/redcode": patch
---

Compaction no longer loops when the conversation outgrows the context window the model is believed to have. A long exchange is summarized down to its newest steps instead of being carried whole in every checkpoint, which sent requests of two to four times the window with 1,024 output tokens and compacted again on the next step. When no checkpoint can fit the window, the turn ends with one message naming the history size, what would remain, the window in use and where it came from, and what to do. A compaction request rejected as too long now shrinks to the window's target rather than to 70% of its own size. The sidebar, prompt footer and mini footer show the window beside the context usage, for example `321.0K / 115.2K (279%)`.
