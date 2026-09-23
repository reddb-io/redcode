---
"@reddb-io/redcode": minor
---

Steer RedRouter combos with System One. In dual reasoning, when the selected model is a RedRouter combo with the `auto` or `smart` strategy and the router accepts hints, each turn sends an `x-red-router-hint` built from System One's classification: complexity and deliberation as units, `needs_tool` when System One recommended a skill or MCP tool, and a tier from the complexity bands. The router picks the model for the turn; Redcode never switches it. A hint outside the router's grammar is never sent. `/setup` (TUI, CLI and web settings) now offers a connected RedRouter that serves System One as the first System One option, saving an evaluator that points at the router and shares the provider's credential.
