---
"@reddb-io/redcode": patch
---

Improve prompt caching and native compaction across Responses routes. Speed up patches for new and emptied files and reuse MCP connections with equivalent settings. Scope web fetch permissions by origin, improve MCP fallback, preserve timeline focus, restore unanswered prompts when interrupted, recover child-session permissions after reconnect, and show session attention on the Windows taskbar.

Opt in to verifiable MCP skills by setting `skills: true` on the MCP server. Code Mode asks for permission when loading a new skill version.

Virtualize the full model picker and create MCP Events automations in Delivery or the TUI `/automation` command. The server resumes MCP push streams from their saved cursors and deduplicates replayed events.
