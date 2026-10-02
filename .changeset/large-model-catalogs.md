---
"@reddb-io/redcode": patch
---

Keep complete OpenAI-compatible catalogs above 500 models. Reuse resolved router definitions, avoid rebuilding unchanged catalogs on every refresh, and restore saved model selections one catalog chunk at a time without retaining a second copy of the full catalog.
