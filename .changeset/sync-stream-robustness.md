---
"@reddb-io/redcode": patch
"@reddb-io/redcode-core": patch
---

Ported from upstream: seven provider and stream fixes

Cerebras keeps its completion limit; Vertex multi-region models route through the regional endpoint; non-native providers behind Cloudflare AI Gateway go through its REST API, and Anthropic's dashed slug is sent correctly through it; Bedrock reasoning that cannot be replayed is filtered before caching, and a `none` reasoning effort is accepted; a cancelled SSE reader no longer surfaces an unhandled rejection.
