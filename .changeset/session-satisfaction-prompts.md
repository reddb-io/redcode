---
"@reddb-io/redcode": patch
---

Include accumulated session satisfaction in dual-reasoning S2 prompts, with a 0–5 score, trend and evidence count. Reuse persisted S1 evaluations without additional model calls, distinguish insufficient evidence, and exclude Observe samples from both the prompt and mood indicator.
