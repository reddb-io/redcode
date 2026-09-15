---
"@reddb-io/redcode-schema": minor
"@reddb-io/redcode-core": minor
"@reddb-io/redcode": minor
---

Progressive tool discovery for the v2 runtime: `redcode design` now defers MCP and Design tools behind `tool_search`, as the legacy runtime already did.

- **Deferral.** With `experimental.tool_search`, MCP tools are held back once their schemas exceed the threshold (default 3000 estimated tokens) and Design tools are held back outside a Design context. The deferred tools are replaced in the advertised list by a single `tool_search` tool, which loads them by keyword or exact name; a loaded tool is advertised from the next step and stays loaded for the rest of the session.
- **The index lives in the system context.** The list of deferred tools is published as `redcode/tool-index` rather than in the tool description, so a server that connects or disconnects mid-session arrives as one system update instead of rewriting — and re-billing — the cached tools block.
- **Provider-native search.** On Anthropic Messages models that support it, the deferred definitions are sent flagged with `defer_loading` next to the provider's own search tool instead of the client-side one, so the provider loads matches itself and the tools block stays cached. `experimental.tool_search.native` controls it (`"auto"` by default, restricted to an allowlist of Claude 4.5-and-later models).
- **Compaction keeps what was loaded.** A v2 compaction message now records the tools loaded through `tool_search` and whether MCP deferral had tripped, so a compaction no longer silently sends every loaded tool back behind the search tool.

The shared half of tool search (what to defer, how the index reads, what one search call answers) moved into `@reddb-io/redcode-core`; the legacy runtime re-exports it and keeps its AI SDK bookkeeping, so legacy behaviour is unchanged.
