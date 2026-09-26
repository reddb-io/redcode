---
"@reddb-io/redcode": patch
---

Promote the V2 session routes into the published protocol and generated clients: `server.sessionV2` exposes prompt (durable admission), session read, messages, durable events and interrupt, with the typed `sessionsV2` client group and regenerated legacy SDK. The server now serves the routes from the protocol group instead of a server-local definition.
