---
"@reddb-io/redcode": patch
---

`redcode setup` and the web reasoning settings now choose the System One evaluator the way the terminal `/setup` does: only from services that already have an active connection, with that connection's own credential. The command no longer asks for an API base URL or an API key, and the web page no longer shows a key field. With no connected service it tells you to run `redcode auth login` first.
