---
"@reddb-io/redcode": patch
---

Make compaction survivable when the context is already at the provider's limit. The compaction threshold now starts 5% below the refusal boundary so a small estimation error cannot overflow first, the summary request is sized by the limit the provider taught us instead of the catalog's (which can overstate it — z-ai/glm-5.3-flash claims 1.3M while OpenRouter enforces 1.05M), and a transcript that no longer fits beside its summary is compacted by keeping the newest part and eliding the middle instead of giving up — a session the provider already refused once now recovers instead of looping on 400s.
