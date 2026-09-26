---
"@reddb-io/redcode": patch
---

Simplify the intelligence setup: remove the separate S2 "transformations" model. Semantic transformations (compaction, plans, todos, goals) now always run on the model in use — the session model or the saved principal — instead of an optional intermediate "fast" model. The `fast` field is gone from intelligence settings, the setup dialogs (TUI, CLI, web), the router recommendations contract and the generated SDKs; stored settings that still contain it are ignored and dropped on the next save.

Also add native OpenRouter support to the V2 session runtime: models whose provider uses `@openrouter/ai-sdk-provider` (for example `openrouter/z-ai/glm-5.3-flash`) now resolve through the native OpenRouter route instead of failing with "Unsupported API for ... aisdk:@openrouter/ai-sdk-provider" in the setup probe and session streaming.