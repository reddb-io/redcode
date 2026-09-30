---
"@reddb-io/redcode": minor
---

Several features whose backend already existed are available in the interfaces again.

The MCPs tab in the TUI can reconnect every enabled MCP server (`R`, asks first when a connection is live) and reload the MCP configuration (`L`), which re-reads the config files and drops servers added or turned off for this run. The API has matching `mcp.restart` and `mcp.reload` routes.

`/worktrees` in the TUI shows each worktree's state (dirty, merged, clean or missing), size and last activity, and a clean action (`ctrl+l`) removes merged, idle worktrees without uncommitted changes after a confirmation, using the same rules as `redcode worktrees clean`.

Removing a provider in the TUI (`ctrl+d` in the provider list, or "Remove provider…" in its accounts) and in the web provider settings now shows what will be removed, such as saved credentials, config entries and, for a router, its MCP server, and asks for confirmation, like `redcode auth remove`.

The model pickers in the TUI, the S2 picker in `/setup` and the web model picker no longer list RedRouter pinned offers as separate models. `ctrl+o` in the TUI, or the offers row on the web, expands a model's offers with provider, price and availability, and choosing one selects that pinned offer.

The web "Reasoning roles" settings can now set the reasoning mode, the S2 principal and fast models and the S1 evaluator. Connections are checked before saving. When a check fails, both the web and TUI `/setup` show the reason (credential, HTTP status, timeout or unreachable) and offer Retry.
