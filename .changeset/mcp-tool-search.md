---
"@reddb-io/redcode": minor
---

Defer MCP tools behind a new `tool_search` tool once their schemas exceed about 3000 tokens, and defer `design_*` tools outside a Design context. The system context lists deferred tools by name, grouped by server. A search or an exact `select` loads them for the rest of the session, and calling a listed tool directly still works. Loaded tools are advertised after every other tool in the order they were loaded, and a server that connects mid-session reaches the model as one system update, so the cached tools block stays intact. Five connected MCP servers drop the first request from about 31k to 11k tokens. Configure with `experimental.tool_search` (`enabled: "auto" | true | false`, `threshold`).
