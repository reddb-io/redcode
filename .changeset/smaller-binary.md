---
"@reddb-io/redcode": patch
---

Make the Redcode executable about 47 MB smaller by shipping the web UI, the bundled model catalog and the legacy Design vendor files as embedded files rather than code, which bytecode stored twice.
