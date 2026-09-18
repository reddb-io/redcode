---
"@reddb-io/redcode": patch
---

Context-overflow refusals in the OpenRouter phrasing ("the request resolved to N input tokens (including image/vision expansion)") now teach the session the provider's real limit. Without the number extraction the learned limit stayed empty, the compaction threshold kept sizing against the catalog's overstated window, and the session could repeat the same 400 on every attempt instead of compacting preventively.
