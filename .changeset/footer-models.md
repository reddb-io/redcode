---
"@reddb-io/redcode": patch
---

Compact the S2/S1 model line in the prompt footer: `Gemini 3.7 Flash·high ⁄ jev-1.13` instead of `S2 Gemini 3.7 Flash* via RedRouter · Antigravity · S1 jev-1.13 · high`. The variant sits right on the S2 model in the accent color, a discreet `⁄` separates the S1 evaluator (or a "S1 setup" hint when it is not configured yet, still clickable), and the route chain (`RedRouter»Antigravity · RedRouter»OpenRouter`) moves to a dim, right-aligned hint shown only when the terminal has spare width. On narrow terminals the route hint disappears first, then the S1 name truncates; the S2 model name is never shortened for width.
