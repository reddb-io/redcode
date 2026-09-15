---
"@reddb-io/redcode": patch
---

Keep the provider prompt cache warm across steps, turns and MCP connects. Native tools now come first in a fixed order and MCP tools follow in server connection order, so a server that connects mid-session appends its tools instead of interleaving them by name. Per-step reminders (task state, goal, plan and design context) travel in a trailing message instead of being appended to the last user prompt, so earlier turns stay byte-identical. Calling an unknown tool returns a short message naming the closest tools instead of listing every tool.
