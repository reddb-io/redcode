---
"@reddb-io/redcode": minor
---

Restore RedRouter model suggestions on the V2 engine. When the router's `recommend_models` tool offers a usable model of the same connection (vision the current model lacks, a larger context, a much cheaper equivalent), the session records it and the TUI shows a compact card above the prompt with the reason and the price, context and capability deltas. `/switch-model` selects the suggested model for the session, `/keep-model` dismisses it and stops that kind of suggestion for the session; nothing switches until you accept. Turn suggestions off with `experimental.model_suggestions: false`.
