---
"@reddb-io/redcode": patch
---

Add a repeatable Docker acceptance lab with two isolated Linux workers, production HTTP/auth/execution/tools, deterministic model fixtures, task patch export and persisted-session recovery after a container crash. The host coordinator cleans up only its own Compose project and keeps review artifacts.

Correct the embedded fetch handler's inferred service requirements to match the fully built route graph, and type-check the Docker worker fixture alongside the server.
