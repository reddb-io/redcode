# Upstream adoption: October 2026

This pass compares Redcode with OpenCode V2 2.0.22
(`d259ae716379a67bcc35943ba75590f1fc7a1b26`) and the models.dev provider
catalog. Changes are adapted to the current Redcode runtime and UX. Open PRs
are proposals, not evidence that a behavior already works upstream.

## Implemented

| Area                | Result in Redcode                                                                                                                                                                                                                                                                      | Upstream reference                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing             | Prefer a finite, nonnegative `usage.cost`, including zero, over catalog estimates. RedRouter's `x-redrouter-cost-usd` still takes precedence. Preserve token accounting and use the same recording path for compaction.                                                                | [OpenCode #52629](https://github.com/anomalyco/opencode/pull/52629), adapted                                                                                                                                                                            |
| Catalog roles       | Fetch the full provider catalog with `api.json?type=all`. Retain `type` and canonical identity without rewriting executable IDs. Specialized models stay out of S2; only compatible JEV offerings become S1 options. Router discovery remains key-scoped and remote.                   | [models.dev #8260](https://github.com/anomalyco/models.dev/pull/8260), [#8583](https://github.com/anomalyco/models.dev/pull/8583)                                                                                                                       |
| Tool history        | Supply missing results for interrupted calls, including trailing calls, and keep system/effort updates after the pending results. Repair only the outgoing request history.                                                                                                            | [OpenCode #52421](https://github.com/anomalyco/opencode/pull/52421), [#52426](https://github.com/anomalyco/opencode/pull/52426)                                                                                                                         |
| Gemini through Chat | Retain and replay thought signatures on parallel OpenAI-compatible calls, including signatures arriving before identity or after arguments.                                                                                                                                            | [OpenCode #51768](https://github.com/anomalyco/opencode/pull/51768), adapted                                                                                                                                                                            |
| Provider failures   | Retain the response body with existing provider/model/URL diagnostics. Show policy explanations during generation and compaction. Recognize Together/TGI overflow so existing compaction recovery can run. Sanitized exports redact response bodies.                                   | [OpenCode #52136](https://github.com/anomalyco/opencode/pull/52136), [#52518](https://github.com/anomalyco/opencode/pull/52518), [#52664](https://github.com/anomalyco/opencode/pull/52664), [#52133](https://github.com/anomalyco/opencode/pull/52133) |
| Provider waits      | Default header and chunk inactivity limits to five minutes. Keep the whole-request budget separate and unset by default. Honor custom limits and `false`; propose stopping after three timeout retries while preserving retry hooks and router quota handling.                         | [OpenCode #49229](https://github.com/anomalyco/opencode/pull/49229), adapted                                                                                                                                                                            |
| MCP                 | Terminate legacy remote sessions before closing, with a one-second bound. Preserve HTTP, network and stderr diagnostics. Retry transient remote startup/catalog failures twice, within one configured operation deadline; execution and authentication failures are not newly retried. | [OpenCode #52414](https://github.com/anomalyco/opencode/pull/52414), [#52418](https://github.com/anomalyco/opencode/pull/52418), [#52614](https://github.com/anomalyco/opencode/pull/52614), adapted                                                    |
| Inactivity          | Keep Locations alive while a person owes a form or permission reply, including child Sessions. Keep background shells attached to their original Location after a Session move. Completed jobs no longer keep Locations alive.                                                         | [OpenCode #50499](https://github.com/anomalyco/opencode/pull/50499), [#52580](https://github.com/anomalyco/opencode/pull/52580), adapted                                                                                                                |
| Restart             | Best-effort PTY preparation/adoption allows service replacement when a handoff is unavailable or stale. Valid tickets still retain terminals; failed adoption leaves an unrelated daemon alone.                                                                                        | [OpenCode #52573](https://github.com/anomalyco/opencode/pull/52573), selected adaptation                                                                                                                                                                |

These reliability and accounting changes do not establish a measured quality,
latency or cost improvement for dual reasoning. Comparative results remain in
[reasoning-evaluation.md](reasoning-evaluation.md).

## Reproducible catalog

Builds consume the committed `packages/core/src/models-dev/snapshot.txt`.
Its manifest records the source URL, SHA-256, provider count, model count and
decision count. This snapshot contains **225 providers, 8,370 offerings and 11
decision offerings**. Counts describe catalog entries; access still depends on
the connected provider, credentials and adapter compatibility.

From `packages/core`, `bun run update-models-snapshot` refreshes the snapshot.
`--file=/path/to/response.json` can replay archived source bytes. `--check`
validates structure, hash and counts without network access and runs in CI.
`REDCODE_MODELS_URL` or `OPENCODE_MODELS_URL` can select a source for an update.

The snapshot is a metadata floor. It never fills an empty RedRouter model list
or grants model access. Remote discovery freshness, key-scoped invalidation
and inference caching remain Router responsibilities. No new Router cache is
introduced in Redcode.

For provider configuration, `settings.headerTimeout` and
`settings.chunkTimeout` default to `300000` milliseconds; `settings.timeout`
limits the entire request only when configured. Each accepts `false` to disable
its own limit. Existing Session stall warnings remain independent.

## Follow-up decisions

| Proposal                                                                        | Decision and dependency                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Incremental monitors #52569](https://github.com/anomalyco/opencode/pull/52569) | Adapt batching and incremental progress into the existing `MonitorRuntime`. Preserve SQLite recovery, native probes, origin-message tracking, vault filtering, stable inbox delivery and active-only UI. The proposed KV service and different tool contract would replace these guarantees. First define progress limits, then test noisy processes, terminal delivery and paused goals. |
| [Reasoning repetition #52669](https://github.com/anomalyco/opencode/pull/52669) | Defer hard stream truncation. The proposal targets the older runtime, scans accumulated reasoning on every delta and drops original signed completion metadata. Introduce bounded observation first; measure false positives on quoted logs/code and legitimate reasoning before connecting detection to Core interruption.                                                               |
| [Per-session cleanup #51583](https://github.com/anomalyco/opencode/pull/51583)  | Do not combine its expiry policy with the pending-human-response fix: a quiet unanswered form is legitimate waiting. Keep process cleanup and human-response admission separate.                                                                                                                                                                                                          |
| [Effect RcMap #52635](https://github.com/anomalyco/opencode/pull/52635)         | Evaluate separately with a repeated reload/disposal reproduction. A dependency identity fix alone does not prove reported CPU or leaked-process symptoms are solved.                                                                                                                                                                                                                      |
| Catalog metadata integrity                                                      | The updater checks structure and snapshot completeness. Cross-field limits, capabilities and service-tier semantics need separate validation; catalog presence is not proof of provider behavior. Track [models.dev #6073](https://github.com/anomalyco/models.dev/issues/6073) and [#5792](https://github.com/anomalyco/models.dev/issues/5792).                                         |

## Validation gate

The Redcode workflow runs canonical lint/typecheck, generated-client drift,
offline snapshot verification and the selected Linux/Windows contracts.
Regressions exercise real protocol parsing, loopback MCP servers, Session
settlement/export, Location cleanup and service restart fixtures. Provider
recordings replay by default and require no paid inference.

CI completion is required before reporting validation. No provider credential
smoke, new benchmark, installed-service restart or release is implied by this
implementation.
