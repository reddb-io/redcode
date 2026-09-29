---
"@reddb-io/redcode": patch
---

Never send a forced tool choice to models that refuse one (Claude Opus 5.5 and later, Fable, Mythos, or a RedRouter model whose parameters say so): requests ask for the tool through `auto`, and structured output asks for the JSON object, validates it against the schema and repairs it once. Classify the `too_many_tokens`, `input_too_long`, `prompt_too_long`, `max_prompt_tokens_exceeded`, `max_context_length_exceeded` and `context_window_exceeded` codes, including ones a router forwards in its error body, as context overflow on 400, 413 and 422, so the session compacts and learns the provider's real limit. Keep output tokens when an OpenAI-compatible server counts reasoning apart from the completion, so cost, budgets and compaction see all of them. RedRouter and 9Router discovery now read `max_input_tokens`, OpenRouter's `top_provider` limits and the models catalog, and give a model nobody describes a 128K context held back by 10% instead of 8K.
