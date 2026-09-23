---
"@reddb-io/redcode": patch
---

Structured output (`LLM.generateObject`) now works on models that refuse a forced tool choice, such as Claude Opus 5.5, Fable and Mythos: it asks for the JSON object, validates it against the schema and repairs it once. A quota, credits or content-policy error that arrives mid-stream on the native Anthropic, OpenAI Responses or Bedrock paths is no longer retried, and a quota error says to check the plan and billing or switch models.
