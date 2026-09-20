# Global intelligence roles (experimental)

Run `redcode setup`, use `/setup` in the TUI, or open **Settings → Intelligence** in the app/desktop. New installations offer setup; **Later** persists the choice. Configuration belongs to the connected server and is shared by its projects. Nothing is enabled by default.

Select three roles:

- **Principal / System Two**: normal agent work and one repair attempt. An explicit session model still takes precedence.
- **Fast / System Two**: structured transformations; can reuse the principal.
- **Evaluator / System One**: native TypeSafe questions. New onboarding recommends OpenCode Zen with `jev-1.13-free`; existing evaluator settings are preserved.

Connect providers using `/connect` or the provider settings first. System One setup lists compatible configured connections before the other available providers and reuses their stored credential. It then tests the selected generative models and a synthetic Noul question before activation. Configuration and API-key storage are separate. Switching evaluator URLs does not implicitly forward the previous connection's key. API clients may explicitly supply an existing `credentialID`; a blank key otherwise reuses this evaluator's saved key or provider environment variable.

## OpenCode Zen default

New setup preselects `https://opencode.ai/zen/v1` and `jev-1.13-free`. The free offer is temporary. Setup checks the Zen catalog and sends a synthetic System One request before activation. If unavailable, setup asks you to check your connection or explicitly choose another evaluator. Runtime never replaces a missing free model with a paid model; unresolved evaluations preserve previous state.

Use a Zen API key from https://opencode.ai/zen if required. For the official Zen URL, a blank key reuses this evaluator's saved credential, an existing OpenCode connection, `OPENCODE_API_KEY`, or Zen's public free access. Activating sends session sources and candidates to Zen. You can select a supported transport and override its compatible base URL and model during setup or later. System One models are excluded from the setup's generative role selectors through catalog protocol capabilities.

## Other JEV providers

Redcode combines the live models.dev catalog with explicit System One protocol metadata. Besides OpenCode Zen, onboarding can offer:

- **TypeSafe** directly at `https://api.typesafe.ai/v1`.
- **RedRouter** at `http://localhost:25050/v1` or a deployed URL.
- **Cloudflare AI Gateway**, using `typesafe/jev` through the documented `/accounts/{account}/ai/run` envelope. Connect it first so Redcode can reuse the account ID, gateway ID and API token.
- **Vercel AI Gateway**, using `typesafe-ai/jev` through its evaluation-model v4 endpoint.
- **Vivgrid**, using `jev` through its native System One endpoint.
- **NanoGPT**, using `typesafe/jev-latest` through its native System One endpoint.

Configured compatible providers are sorted first in CLI, TUI and app setup. The free Zen connection remains the default for a fresh installation.

TypeSafe, RedRouter, Zen, Vivgrid and NanoGPT use the native System One body: `model`, `state`, `questions`. Cloudflare wraps `state` and `questions` under `input`. Vercel uses its evaluation-model protocol; Redcode translates Noul to the protocol's Boolean question and normalizes its response back to the TypeSafe answer shape. None of these evaluators is sent through chat completions.

OpenRouter is not offered as a System One connection. As of 2026-09-20, neither `https://models.dev/api.json` nor OpenRouter's public model catalog contains a JEV model, and the models.dev OpenRouter history has never carried one. Add it only after OpenRouter publishes a concrete evaluation model and transport contract.

Router discovery uses `GET /v1/models/systemone`. Direct discovery uses `/v1/models`; when unavailable, enter the model name manually. The sibling red-router changes classify `systemOne` entries separately and dispatch the discovery endpoint to its native handler.

## State transitions

Generated TODO extraction, missing plan decomposition, feedback interpretation and checkpoint summaries follow fast generation → structural validation → evaluation → at most one principal repair → re-evaluation. Explicit task/plan updates are evaluated against source requests. Existing deterministic evidence, permissions, revisions and design approval checks remain authoritative. Task checks run before evaluation and stale source snapshots cannot commit.

Each Noul asks about an **error**: values ≤ 0.1 accept, ≥ 0.9 require revision, and intermediate values are inconclusive. All required checks must accept. These are experimental policy thresholds, not measured accuracy guarantees. Missing answers, malformed responses, timeouts and provider failures cannot approve a change. Feedback keeps its raw input when interpretation fails; its rendered admission is frozen for exact retries. Failed checkpoint validation leaves history intact.

Semantic early compaction checks start only after four user turns and at least half of the configured context threshold. Hard context limits still apply. Large checkpoint sources are checked in overlapping chunks; this conservative policy can reject summaries that need cross-chunk context. Ordinary evaluations exceeding the request budget fail closed.

## Inspection and validation

The global configuration directory contains `intelligence.json`, `evaluations/` (sources, candidates, question policy, response usage and latency), and `generations/` (auxiliary role/model and provider-reported usage). These artifacts may contain session content. No API key is included in public setup or evaluation records. Interrupted generation may have no provider usage; token counts are not billing totals. The settings panel shows recent evaluation results. Disable through setup to restore the ordinary path.

Global endpoints are `/api/intelligence` (GET/PUT), `/models`, `/test`, `/evaluations?sessionID=...`; the generative `/test-model` probe uses location services. Existing server authentication protects them.

From `packages/core`, run:

```sh
bun test test/intelligence.test.ts test/session-todo.test.ts test/tool-todowrite.test.ts test/tool-goal-plan.test.ts test/session-compaction-background.test.ts test/design-rounds.test.ts
bun script/evaluate-intelligence.ts > intelligence-results.json
```

The live harness requires a provider key and uses a small labeled English/Portuguese smoke dataset. Override `SYSTEM_ONE_BASE_URL` and `SYSTEM_ONE_MODEL` for router/model comparisons. Optional `SYSTEM_ONE_INPUT_USD_PER_MILLION` and `SYSTEM_ONE_OUTPUT_USD_PER_MILLION` produce a cost estimate. Reports include false approvals, false blocks, uncertainty, tokens and latency. Expand with representative application data before tuning thresholds; this smoke dataset is not a production benchmark.
