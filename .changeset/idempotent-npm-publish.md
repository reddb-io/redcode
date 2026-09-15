---
"@reddb-io/redcode": patch
---

Make the release publish step safe to rerun while npm registry reads lag: an E409 republish conflict counts as already published, platform packages must be visible before `@reddb-io/redcode` is published, and the smoke step waits for every package and names the ones still missing.
