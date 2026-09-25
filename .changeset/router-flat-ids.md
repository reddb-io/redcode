---
"@reddb-io/redcode": minor
---

Support RedRouter flat model ids. A RedRouter key whose model list says `id_format: "flat"` lists one entry per model (`anthropic/claude-sonnet-4-5`, `typesafe/jev-1.13`) instead of one per provider. Redcode treats each entry as a fallback combo over its offers. Labels, System One detection and "also direct" matching come from the offers, never from splitting the flat id, so `typesafe/jev-1.13` is not shown as served by a provider "typesafe". The model pickers show the route the model will be served by and, with ctrl+o in the TUI or the chevron on the web, its offers with their route, price and a free badge. Picking an offer pins it by its `pin_id`; an offer without one cannot be pinned. A response names the offer that served it by its route, and a session follows that offer's limits and reasoning levels. A model list without `id_format` is read as prefixed, as before.
