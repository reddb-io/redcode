---
"@reddb-io/redcode": minor
---

Rework `/setup`, `redcode setup` and the web intelligence settings around the reasoning mode. Setup now starts by choosing Simple (one model) or Dual (S1 classifies and validates, S2 executes), preselecting the effective mode and noting a `--reasoning` override. A saved System Two model can be kept with "Continue with…" instead of walking through the model list again, and dual setup offers the same shortcut for a saved System One evaluator. Simple reasoning saves only S2 and never asks for or probes an evaluator.
