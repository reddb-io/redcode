---
"@reddb-io/redcode": patch
"@reddb-io/redcode-core": patch
---

Ported from upstream: tolerate Anthropic's thinking block binding on Claude 5.1+

Fable 5.1 binds each thinking signature to the system prompt, tool list and messages above it, and rejects the request when any of that changes between turns. Requests to Claude 5.1+ (direct, Vertex, Bedrock) now ask the API to drop the affected blocks instead of failing, via patched `@ai-sdk/anthropic` 3.0.111 and `@ai-sdk/amazon-bedrock` 4.0.166; the blocks Anthropic reports dropping are logged. Set `thinking.blockBinding: false` (or `reasoningConfig.blockBinding: false` on Bedrock) in the model's provider options to opt out.
