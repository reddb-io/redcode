---
"@reddb-io/redcode": minor
---

Suggest a better RedRouter model or combo, and switch only when you say so. With a RedRouter that serves its MCP server (schema 2 or later, red-router v0.28.0), Redcode notices when the session attaches images the model cannot see, needs tools it cannot call, nears its context limit, keeps failing at the provider (or, with schema 3, its provider's quotas are nearly used up), or has a much cheaper equivalent. It asks the router's `recommend_models` and shows a card in the TUI and the web app: `Suggest: <route> — <why>`, the price, context and capability deltas, and switch / keep (`/switch-model`, `/keep-model`). Nothing switches until you accept; keep silences that trigger for the session, and a suggestion never loses a capability the session needs. Turn it off with `experimental.model_suggestions: false`.
