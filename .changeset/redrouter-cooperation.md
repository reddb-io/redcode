---
"@reddb-io/redcode": minor
---

Restore RedRouter cooperation on the V2 engine. Requests tell a detected RedRouter what it advertised it reads: the `x-red-router-hint` for combos that pick their member per request, the reasoning header (a person's own variant is never overridden), and the token saver and decision layer turned off where the prompt must stay whole. Responses report the model that served each step and its cost, which the step's spend now counts, and a new catalog version refreshes the router's models at once.

Models whose router accepts automatic reasoning offer an `auto` variant first, which leaves the effort to RedRouter's reasoning autopilot. Flat model ids carry their offers, and every offer with a pin id can be selected as its own model with its provider, route, price, limits and thinking levels. Combos plan for their strictest member when they state no parameters of their own, and never ask for a forced tool choice that any member refuses.

The RedRouter key's role and MCP server are read on each catalog refresh and saved on the provider, and the key's MCP server is registered automatically (a server you configure under the same name wins). Its key-management tools (creating or listing API keys, reading another key's usage) always ask, can only be allowed once, and are never approved by permission rules, saved approvals, auto-accept or `--yolo`.
