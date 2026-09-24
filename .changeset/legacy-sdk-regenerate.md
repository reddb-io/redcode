---
"@reddb-io/redcode": patch
---

Regenerate the legacy JavaScript SDK from the server's HttpApi. Adds design, intelligence, and RedRouter-connect client methods that had drifted out of sync with hand-edited generated files, and drops a few unused response types (`RouterUpstream`, `RouterVariant`, `RouterConnection`, `ForbiddenError`) that no route referenced anymore.
