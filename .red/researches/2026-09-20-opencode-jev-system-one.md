# OpenCode JEV and System One integration

Date: 2026-09-20
Query: Review how upstream OpenCode handles JEV in its latest pull requests and versions.
Scope: Official `anomalyco/opencode` commits, documentation, release metadata, issues, and pull requests through 2026-09-20. This covers transport and catalog behavior; it does not treat unmerged community proposals as shipped behavior.

## Executive Summary

OpenCode treats JEV as a separate System One protocol, not as a chat model. Its Zen gateway proxies `POST /zen/v1/systemone` to TypeSafe's `/systemone` endpoint, forwards the native `{ model, state, questions }` body, disables streaming, and accounts for token usage. Its documentation explicitly says JEV does not generate text and supports `noul`, `choice`, and `score`, including several questions in one request.

This support is newer than the latest published OpenCode release. The latest release is `v1.18.31`, published 2026-09-14. JEV support landed directly on `dev` on 2026-09-18, followed by model-list and usage documentation on 2026-09-19. It therefore remains unreleased as of this report.

OpenCode's application model catalog still exposes JEV alongside language models. This already caused an open bug in which an unpinned session selected `jev-1.13-free` as the newest default model and then failed because JEV is not a usable chat/tool model. An open UI PR also makes family-less catalog models such as JEV visible in the model picker. Redcode should keep its stronger protocol separation: tag known JEV offers as `systemone`, exclude them from all System Two selectors and defaults, and call them only through the evaluator transport.

## Official Sources

- [OpenCode repository](https://github.com/anomalyco/opencode) — canonical upstream repository; its default branch is `dev`.
- [support jev commit](https://github.com/anomalyco/opencode/commit/1573a7b608eb13c45a2243201964c7784f2a8281) — introduces the Zen System One transport, routing, usage normalization, and tests.
- [JEV model documentation commit](https://github.com/anomalyco/opencode/commit/61eae8811a0297d16c681c940f15ae1787f924aa) — lists paid and temporary free JEV variants with the dedicated endpoint and pricing.
- [JEV usage documentation commit](https://github.com/anomalyco/opencode/commit/11be5bc29cbb6572a042361c5d1ff642c99b0605) — documents the typed request contract and multi-question behavior.
- [OpenCode Zen docs on `dev`](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/zen.mdx#jev) — current endpoint, examples, pricing, and free-offer status.
- [OpenCode v1.18.31](https://github.com/anomalyco/opencode/releases/tag/v1.18.31) — latest published release before JEV support landed.
- [Issue #50032](https://github.com/anomalyco/opencode/issues/50032) — demonstrates that a JEV catalog entry can be incorrectly selected as a generative session default.
- [PR #50107](https://github.com/anomalyco/opencode/pull/50107) — open UI fix that explicitly tests visibility of `Jev 1.13 Free` as a family-less model.
- [PR #50139](https://github.com/anomalyco/opencode/pull/50139) — closed, unmerged proposal to use JEV for automatic generative-model routing; useful only as a design candidate.

## Hotlinks

- [System One proxy helper](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/util/provider/systemone.ts) — appends `/systemone`, passes the body unchanged, sets bearer auth and session affinity, and normalizes usage.
- [Zen System One endpoint](https://github.com/anomalyco/opencode/blob/dev/packages/console/app/src/routes/zen/v1/systemone.ts) — selects the `systemone` format with no streaming.
- [JEV usage docs](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/zen.mdx#jev) — states that JEV returns structured values and probabilities instead of generated text.

## Key Findings

1. Upstream has protocol-level separation in its gateway. `systemone` is a distinct provider format beside `anthropic`, `google`, `openai`, and `oa-compat`.
2. The public endpoint is `POST https://opencode.ai/zen/v1/systemone`. The body is the native TypeSafe System One shape and is not translated into chat messages.
3. The models are `jev-1.13` and `jev-1.13-free`. The free variant is explicitly temporary. Paid input pricing is documented as `$0.042` per million tokens and output as free.
4. JEV answers typed questions: `noul`, `choice`, and `score`. Multiple questions belong in one request and are evaluated in parallel.
5. Upstream does not yet use JEV internally for compaction completeness, task completion, or other agent lifecycle gates. The shipped upstream work is gateway support and documentation.
6. A closed, unmerged PR proposed using OpenRouter Decisions for model routing. It cached the result per session and had a generative fallback, but this is not upstream behavior.
7. The catalog/application boundary is currently incomplete upstream. JEV can enter normal model selection and even become the default for a model-less session. This is the failure mode Redcode must avoid.

## API / CLI / Config Details

- Endpoint: `POST /zen/v1/systemone`
- Request: `{ "model": "jev-1.13-free", "state": ..., "questions": ... }`
- Authentication: `Authorization: Bearer $OPENCODE_API_KEY` in the official example.
- Streaming: disabled.
- Transport target: provider base URL plus `/systemone`.
- Session affinity: forwarded as `x-session-affinity`.
- Usage: reads `usage.input_tokens` and `usage.output_tokens`.

## Version Notes

- `v1.18.31` was published 2026-09-14 and does not include the JEV commits.
- Gateway support commit `1573a7b6` landed 2026-09-18.
- Model-list documentation commit `61eae881` landed 2026-09-19.
- Usage documentation commit `11be5bc2` and heading correction `ebb7b76e` landed 2026-09-19.
- As of 2026-09-20, `dev` contains those changes and no newer published release includes them.

## Gotchas

- Do not infer JEV availability from a provider's chat-model list. OpenRouter exposes it through Decisions, while Zen exposes it through System One.
- Do not let a `systemone` catalog entry enter a generative model picker, default-selection algorithm, or chat execution path.
- Do not treat PR #50139 as landed functionality; it was closed without merge.
- Do not rely only on model-family grouping to distinguish protocols. The protocol capability must be explicit.
- The Zen free variant is temporary, so onboarding must allow the user to replace the evaluator and must not silently fall back to the paid JEV model.

## Open Questions

- Whether upstream will add a first-class protocol capability to its shared model catalog after issue #50032.
- Whether OpenCode will adopt JEV for internal lifecycle decisions rather than only providing gateway access.
- Whether the temporary `jev-1.13-free` offer will remain available when Redcode's next release is installed.

## Source-by-Source Notes

- `1573a7b6` adds eight files/changes: two endpoint routes, inference-proxy mappings, a `systemone` provider helper, the format enum, and focused tests.
- `11be5bc2` adds the same typed JEV usage section across the translated Zen documentation.
- Issue #50032 records `jev-1.13-free` being selected as a normal session default with `tools: false`, followed by provider failure.
- PR #50107 is currently open and blocked; it aims to show family-less models in the picker and explicitly uses JEV as its manual verification case.

## Recommended Next Steps

1. Preserve Redcode's explicit `capabilities.protocol = "systemone"` classification and filtering from System Two model selectors and runtime resolution.
2. Keep OpenCode Zen as the recommended evaluator using `jev-1.13-free`, with a clear temporary-offer label and no silent paid fallback.
3. Use JEV internally only through typed evaluation policies. Start with `Noul` error questions for fail-closed gates; add `Choice` for routing and `Score` for ranking when the consuming code genuinely needs those shapes.
4. Keep task completion and compaction decisions auditable: persist question IDs, raw answer probabilities, thresholds, evaluator identity, and policy version.
5. Recheck upstream issue #50032 and later releases before importing future model-catalog behavior.
