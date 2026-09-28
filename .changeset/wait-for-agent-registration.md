---
"@reddb-io/redcode": patch
---

Wait for plugin activation before listing agents from a newly started server, so `agent list` and `debug agents` include Redcode's built-in and configured agents on their first request.
