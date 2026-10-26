---
"@reddb-io/redcode": patch
---

Return `--version` and `-v` before loading CLI services or initializing configuration, storage and telemetry, so a version query can succeed even when application startup is blocked.
