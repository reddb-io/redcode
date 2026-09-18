---
"@reddb-io/redcode": minor
---

Compaction summaries survive an output-limit cut and the summary budget is configurable. A summary whose provider finish was `length` (common with reasoning models that spend the output budget thinking, e.g. GLM-5.3-Flash) is now committed instead of failing the compaction and preserving the full history. The summary output budget defaults to 32k tokens (was 16k) and can be changed with `compaction.summary_max_tokens` in config; the model's own output limit still caps it.
