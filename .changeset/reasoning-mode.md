---
"@reddb-io/redcode": minor
---

Add single and dual reasoning modes. Unconfigured redcode now runs in `single` mode on the session's selected model (S2 only): completion gates keep their structural evidence checks and executed shell gates and report S1 as "not verified (single reasoning)". `dual` adds the System One evaluator with the existing strict contract, where an unavailable or inconclusive review is never approval. Choose the mode per run with `--reasoning single|dual` or `REDCODE_REASONING`, overriding the saved setting; settings saved with an enabled evaluator stay dual.
