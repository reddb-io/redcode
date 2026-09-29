---
"@reddb-io/redcode": patch
---

Compact the S2/S1 model line in the TUI prompt footer: `Gemini 3.7 Flash·high ⁄ JEV 1.13` instead of `S2 Gemini 3.7 Flash · high ⁄ S1 JEV 1.13 RedRouter » Antigravity · RedRouter`. The variant sits right on the S2 model in the accent color, a discreet `⁄` separates the S1 evaluator (or a clickable "S1 setup" hint when it is not configured yet), and the route chain (`RedRouter»Antigravity · RedRouter`) moves to a dim, right-aligned hint shown only when the terminal has spare width. On narrow terminals the route hint disappears first, then the S1 name truncates; the S2 model name is never shortened for width.

Show what a RedRouter key may do again: the TUI's `/connect` and `/setup` say "standard key" or "admin key", and so do the web app's provider settings. The retry status now names the model it waits for and, for a quota, when it resets: `Retrying in 42s · Gemini 3.7 Flash quota exhausted until 14:05 · attempt 2 · …`.
