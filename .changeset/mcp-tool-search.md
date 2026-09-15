---
"@reddb-io/redcode": minor
---

Defer MCP tools behind a new `tool_search` tool once their schemas exceed about 3000 tokens, and defer `design_*` tools outside a Design context. Deferred tools are listed by name, grouped by server, in the `tool_search` description; a search or an exact `select` loads them for the rest of the session, and calling a listed tool directly still works. Five connected MCP servers drop the first request from about 31k to 11k tokens. Configure with `experimental.tool_search` (`enabled: "auto" | true | false`, `threshold`).
