---
"@reddb-io/redcode": minor
---

Consolidate the October OpenCode integration in Redcode 0.78.0, preserving Design, Vault, S1/S2 review, Console authentication, infrastructure access and distributed-worker capabilities.

- **Agent engine:** recover corrupt Git snapshot indexes, support concurrent snapshots and large reverts, expose worktree create/list/remove tools, and keep subagent completion tracked when a project's runtime is unloaded. Preserve mixed line endings during edits and allow a configured summary-compaction model while giving explicit S2 transformations priority. Compaction continues to record the active worktree's branch and changed-file counts.
- **Providers:** add ChatGPT token sharing alongside existing Codex login methods, Google Vertex project/location setup, corrected Copilot routing and reasoning replay, and compatible-model option migration. ChatGPT token sharing still requires provider-side account/client eligibility.
- **CLI and TUI:** require consent on first remote-access setup, add periodic update checks, improve plugin-dialog search and preserve saved unavailable model selections. Headless remote setup uses explicit `--yes` consent.
- **Server and SDK:** stream file downloads with conditional requests and byte ranges, validate terminal connections before loading project services, archive inactive projects whose known checkouts disappeared without deleting history, initialize startup plugins before recovery, and expose plugin session creation, compaction and removal.
- **Policies and boundaries:** apply live provider/tool/integration restrictions to plugins, MCP servers and skills, retain the last valid remote configuration through transient failures, report MCP token-exchange errors correctly, and restrict SQLite files to their owner on POSIX systems.
- **Documentation:** refresh the README with component-specific release highlights and links to the adoption record while preserving its SVG artwork and progressive navigation.

See [the adoption record](https://github.com/reddb-io/redcode/blob/main/docs/upstream-adoption.md) for source references and remaining work. Open upstream proposals are not included as shipped features. Physical Raspberry Pi acceptance and full SaaS tenant isolation remain separate work.
