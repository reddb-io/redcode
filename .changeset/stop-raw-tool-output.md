---
"@reddb-io/redcode": patch
---

Stop a provider stream when a raw GLM-style call to an available tool leaks into ordinary response text. Report a non-retryable format error instead of allowing the malformed argument body to keep streaming. Preserve native tool calls, reasoning telemetry, and fenced examples.
