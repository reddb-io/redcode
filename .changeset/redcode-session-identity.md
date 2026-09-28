---
"@reddb-io/redcode": patch
---

Restore the Redcode experience on the V2 engine: open real blank sessions at startup and through /new and /clear, restore the Redcode default theme and stable built-in agent colors, and keep Context, Workers and Subagents visible in the session workspace.

Restore the persisted task sidebar through the V2 session API and preserve the existing Goal slash commands.

Restore session modified files and language-server status in the sidebar, and reconnect /monitors to authenticated V2 list, inspect and cancellation APIs with session isolation and bounded evidence.

Keep the modified-files sidebar cumulative across the full session instead of displaying only the latest interaction.
