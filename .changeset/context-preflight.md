---
"@reddb-io/redcode": minor
---

Size every request by the limit the provider actually enforces, and never send one that cannot fit

Sessions on routers (9Router, OpenRouter) and corporate proxies kept failing with `400 input length X exceeds the maximum allowed input length of Y tokens`: the catalog's context window was larger than what the provider behind the router enforced, so proactive compaction never fired, the request's own growth since the last step was never counted, and a router's envelope hid the upstream message from the overflow classifier.

- A refusal that carries numbers teaches Redcode the provider's input limit for that provider and model, along with how far the character estimate was off. The lesson is kept in `model-limits.json` under the state directory, applied as the smaller of the catalog's limit and the provider's, shown by `redcode debug limits` (`--forget` drops one), and cleared when `limit.context` or `limit.input` for the model is set or changed in configuration. The TUI is told once per session when a limit is learned.
- Both runtimes preflight every provider request: the provider's count for the last step plus what history gained since, scaled by the learned calibration, against the compaction threshold. Over it, old tool output is trimmed or the history compacted before anything is sent; over the provider's limit after two recoveries in a turn, the turn ends with a clear message instead of a doomed request.
- Router envelopes (`error.metadata.raw`, `Provider returned error`) and the codes `too_many_tokens`, `model_context_window_exceeded`, `input_too_long`, `prompt_too_long`, `max_prompt_tokens_exceeded`, `max_context_length_exceeded` and `context_window_exceeded` classify as context overflow on every adapter path.
- Router discovery reads `max_input_tokens` and OpenRouter's `top_provider` limits, and a model whose context nobody reports gets a guess held back by ten percent.
