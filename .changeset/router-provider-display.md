---
"@reddb-io/redcode": minor
---

Show where every model comes from: models served through a RedRouter are grouped by the upstream provider behind them and labeled `via RedRouter · <provider>` (with `subscription` for subscription accounts), directly connected providers are labeled `direct`, and a model available both ways says so. The prompt footer, `/setup` and the web model picker use the same labels, the session header shows the model RedRouter actually served, reasoning levels and modes (such as review) appear on their model instead of as separate models, and the web settings name a RedRouter connection instead of calling it custom. Connections now record which router they are, and after RedRouter switches to readable model ids (`codex/gpt-5.6-sol` instead of `cx/gpt-5.6-sol`) saved models, default and agent models, favorites, recents and System Two models move to the new ids while old ids keep working. A background catalog refresh that changes the models shows a notice.
