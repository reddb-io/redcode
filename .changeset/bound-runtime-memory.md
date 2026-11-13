---
"@reddb-io/redcode": patch
---

Reduce server memory retained by idle model connections and slow event consumers. Slow event consumers use encrypted temporary storage, and events with values that cannot be safely serialized are rejected before publication.

Persist pending deliveries for session usage, project catalogs, and selected provider credential consumers in an encrypted journal and retry them after a restart.
