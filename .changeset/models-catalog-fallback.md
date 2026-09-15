---
"@reddb-io/redcode": patch
---

Keep the models catalog working on networks that block `models.opencode.ai`. Redcode now tries `REDCODE_MODELS_URL`, then the new global `models.sources` config list, then `https://models.opencode.ai/api.json` and `https://models.dev/api.json`, and falls back to the disk cache or the catalog bundled into the release. A source that answers 401, 403, 407 or 451, fails with a proxy or TLS error, or returns a page that is not a catalog is skipped for 1h, then 6h, then 24h. The backoff is persisted, so restarts don't retry it, and the source logs one warning instead of an error every refresh. A block page never replaces a good cache, and `models-dev.refreshed` is emitted only when the catalog changes. `redcode models --verbose` prints the catalog origin, age and blocked sources. Release builds now fail when no source yields a valid catalog, instead of embedding whatever the request returned.
