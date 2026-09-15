---
"@reddb-io/redcode": minor
---

Connect 9Router directly from /connect: confirm the API URL (a missing scheme, a trailing /models and a bare host are accepted), paste the key, and pick a discovered model. The server saves the provider to global configuration and the key to the credential store in one call, sets model limits from the router, the models catalog or a conservative default so compaction keeps working, and removes previously discovered models the router no longer lists while keeping customized ones.
