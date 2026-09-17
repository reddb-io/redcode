---
"@reddb-io/redcode": patch
---

Output tokens are no longer lost when an OpenAI-compatible server counts reasoning apart from them.

OpenAI reports reasoning tokens as part of `completion_tokens`. Some OpenAI-compatible servers, and the proxies in front of them, report `completion_tokens` as the visible answer only and add the reasoning on top; their `total_tokens` shows it (`prompt + completion + reasoning`). Redcode subtracted reasoning from completion anyway, so a reply with 120 visible and 800 reasoning tokens was stored as 0 output tokens.

Such usage is now recognised from the provider's own total, and only from it: with no `total_tokens`, or a total that already contains reasoning, nothing changes. Both runtimes are affected: the AI SDK path (`@ai-sdk/openai-compatible`) and the native OpenAI Chat protocol, which the V2 runtime also uses.

**Cost and budget impact.** For those providers only, a step's output tokens now include the visible answer that used to be subtracted away. In the example above, the 120 output tokens are now counted, so:

- the step's cost rises by 120 × the model's output price;
- session and goal token totals rise by the same amount, and spend budgets and goal token budgets (legacy and V2) reach their limits correspondingly sooner;
- compaction and overflow estimates, which use the reported output, see the larger context.

Providers that report reasoning inside completion (OpenAI, and xAI and Gemini through their own AI SDK providers) are unchanged.
