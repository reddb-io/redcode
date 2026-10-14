---
"@reddb-io/redcode": patch
---

Exclude service data, cache and state directories from configuration watches when they share the global configuration root. Log and database writes no longer trigger configuration reloads or add recursive watches over runtime data; authored configuration changes remain observable.
