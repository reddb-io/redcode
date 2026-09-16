---
"@reddb-io/redcode-schema": minor
"@reddb-io/redcode-core": minor
"@reddb-io/redcode": minor
---

Progressive tool discovery for the v2 runtime: `redcode design` now defers MCP and Design tools behind `tool_search`, as the legacy runtime already did.

- **Deferral.** With `experimental.tool_search`, MCP tools are held back once their schemas exceed the threshold (default 3000 estimated tokens) and Design tools are held back outside a Design context. The deferred tools are replaced in the advertised list by a single `tool_search` tool, which loads them by keyword or exact name; a loaded tool is advertised from the next step and stays loaded for the rest of the session.
- **The index is its own system part.** The list of deferred tools is sent as a system part rather than in the tool description, so a server that connects or disconnects changes that text instead of rewriting — and re-billing — the cached tools block.
- **Provider-native search.** On Anthropic Messages models that support it, the deferred definitions are sent flagged with `defer_loading` next to the provider's own search tool instead of the client-side one, so the provider loads matches itself and the tools block stays cached. `experimental.tool_search.native` controls it (`"auto"` by default, restricted to an allowlist of Claude 4.5-and-later models). A provider that refuses the feature does not take the turn down with it: the step is replayed with the client-side tool, and the model is remembered as unsupported for the rest of the process. A tool reference the provider cannot resolve falls back for that step only, since it comes from the session's own history rather than from missing support.
- **The advertised order is the activation order.** Tools that can never be deferred come first, then `tool_search`, then everything loaded so far in the order this session loaded it. Loading one more tool appends to the list instead of reshuffling it, which is what keeps the provider's cached tools prefix valid — the saving the whole feature exists for.
- **Compaction keeps what was loaded.** A v2 compaction message now records the tools loaded through `tool_search` and whether MCP deferral had tripped, so a compaction no longer silently sends every loaded tool back behind the search tool.

The shared half of tool search (what to defer, how the index reads, what one search call answers) moved into `@reddb-io/redcode-core`; the legacy runtime re-exports it and keeps its AI SDK bookkeeping, so legacy behaviour is unchanged.
