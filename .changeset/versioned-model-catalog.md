---
"@reddb-io/redcode": minor
---

Read models.dev V2 catalogs and expose the payload digest, format, declared APIs, effective protocol capabilities, MIME types and unit-aware prices on model metadata. Select executable chat routes only from locally registered adapters while preserving the provider's model ID and canonical identity separately.

Preserve cache TTLs, conditional prices, reasoning prices, media units and search prices without coercing them into an unconditional token tariff. Missing or unsupported token estimates remain absent; known zero input alone no longer labels a model free. Invalid catalog JSON cannot replace the previous good cache. Require V2 for the bundled snapshot, configured sources, caches and public metadata.

Keep catalog JSON arrays editable through both Effect and Promise plugin drafts without mutating the shared source snapshot.
