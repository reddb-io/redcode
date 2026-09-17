---
"@reddb-io/redcode": patch
---

Show reasoning token counts in the TUI thinking header. While the model thinks, the spinner reads `Thinking: title · 1.3K tokens`, updating live from the message's reasoning tokens, and the finished line reads `Thought: title · 2s · 1.3K tokens` using compact `Locale.number` notation.
