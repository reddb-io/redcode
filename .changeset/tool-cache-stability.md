---
"@reddb-io/redcode": patch
---

Keep the provider prompt cache warm across steps, turns and MCP connects.

- Tools are advertised in fixed blocks: native tools sorted by name, MCP resource tools, `tool_search`, directly advertised MCP tools, then tools activated through `tool_search` in activation order. MCP servers keep a durable order (config order, then first-seen) that survives restarts, reconnects and connection timing, so a server connecting mid-session appends its tools instead of interleaving them by name.
- Per-step reminders (task state, goal, plan and design context) travel in a trailing `<system-reminder>` message instead of being appended to the last user prompt, so earlier turns stay byte-identical. Cache breakpoints skip that message. Plugins using `experimental.chat.messages.transform` or the Agent PreStep hook no longer see these reminder parts in the step's messages.
- Calling an unknown tool returns a message of at most 300 bytes naming the closest tools instead of listing every tool.
