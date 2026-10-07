# Upstream adoption: October 2026

This pass compares Redcode with OpenCode V2 2.0.22
(`d259ae716379a67bcc35943ba75590f1fc7a1b26`) and the models.dev provider
catalog. Changes are adapted to the current Redcode runtime and UX. Open PRs
are proposals, not evidence that a behavior already works upstream.

## Implemented

| Area                  | Result in Redcode                                                                                                                                                                                                                                                                      | Upstream reference                                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Billing               | Prefer a finite, nonnegative `usage.cost`, including zero, over catalog estimates. RedRouter's `x-redrouter-cost-usd` still takes precedence. Preserve token accounting and use the same recording path for compaction.                                                                | [OpenCode #52629](https://github.com/anomalyco/opencode/pull/52629), adapted                                                                                                                                                                            |
| Catalog roles         | Fetch the full provider catalog with `api.json?type=all`. Retain `type` and canonical identity without rewriting executable IDs. Specialized models stay out of S2; only compatible JEV offerings become S1 options. Router discovery remains key-scoped and remote.                   | [models.dev #8260](https://github.com/anomalyco/models.dev/pull/8260), [#8583](https://github.com/anomalyco/models.dev/pull/8583)                                                                                                                       |
| Tool history          | Supply missing results for interrupted calls, including trailing calls, and keep system/effort updates after the pending results. Repair only the outgoing request history.                                                                                                            | [OpenCode #52421](https://github.com/anomalyco/opencode/pull/52421), [#52426](https://github.com/anomalyco/opencode/pull/52426)                                                                                                                         |
| Gemini through Chat   | Retain and replay thought signatures on parallel OpenAI-compatible calls, including signatures arriving before identity or after arguments.                                                                                                                                            | [OpenCode #51768](https://github.com/anomalyco/opencode/pull/51768), adapted                                                                                                                                                                            |
| Provider failures     | Retain the response body with existing provider/model/URL diagnostics. Show policy explanations during generation and compaction. Recognize Together/TGI overflow so existing compaction recovery can run. Sanitized exports redact response bodies.                                   | [OpenCode #52136](https://github.com/anomalyco/opencode/pull/52136), [#52518](https://github.com/anomalyco/opencode/pull/52518), [#52664](https://github.com/anomalyco/opencode/pull/52664), [#52133](https://github.com/anomalyco/opencode/pull/52133) |
| Provider waits        | Default header and chunk inactivity limits to five minutes. Keep the whole-request budget separate and unset by default. Honor custom limits and `false`; propose stopping after three timeout retries while preserving retry hooks and router quota handling.                         | [OpenCode #49229](https://github.com/anomalyco/opencode/pull/49229), adapted                                                                                                                                                                            |
| MCP                   | Terminate legacy remote sessions before closing, with a one-second bound. Preserve HTTP, network and stderr diagnostics. Retry transient remote startup/catalog failures twice, within one configured operation deadline; execution and authentication failures are not newly retried. | [OpenCode #52414](https://github.com/anomalyco/opencode/pull/52414), [#52418](https://github.com/anomalyco/opencode/pull/52418), [#52614](https://github.com/anomalyco/opencode/pull/52614), adapted                                                    |
| Inactivity            | Keep Locations alive while a person owes a form or permission reply, including child Sessions. Keep background shells attached to their original Location after a Session move. Completed jobs no longer keep Locations alive.                                                         | [OpenCode #50499](https://github.com/anomalyco/opencode/pull/50499), [#52580](https://github.com/anomalyco/opencode/pull/52580), adapted                                                                                                                |
| Restart               | Best-effort PTY preparation/adoption allows service replacement when a handoff is unavailable or stale. Valid tickets still retain terminals; failed adoption leaves an unrelated daemon alone.                                                                                        | [OpenCode #52573](https://github.com/anomalyco/opencode/pull/52573), selected adaptation                                                                                                                                                                |
| Monitor progress      | Publish bounded snapshots of saved native probe attempts at most once per two seconds per monitor. Update the existing TUI rows directly; preserve recovery, terminal delivery, origin gating and active-only display.                                                                 | [OpenCode #52569](https://github.com/anomalyco/opencode/pull/52569), selected adaptation                                                                                                                                                                |
| Reasoning observation | Detect repetition with bounded per-attempt state and record content-free diagnostics. Preserve output, signatures and completion metadata; observation does not interrupt the stream.                                                                                                  | [OpenCode #52669](https://github.com/anomalyco/opencode/pull/52669), selected adaptation                                                                                                                                                                |

These reliability and accounting changes do not establish a measured quality,
latency or cost improvement for dual reasoning. Comparative results remain in
[reasoning-evaluation.md](reasoning-evaluation.md).

## October 7 reliability follow-up

This follow-up adapts selected OpenCode V2 fixes without replacing Redcode's
history repair, vault handling, durable Session execution, or provider accounting.

| Area                | Adaptation                                                                                                                                                                                                                                           | Source                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Responses replay    | Unfinished reasoning loses provider continuation metadata; readable partial text remains plain text. Empty reasoning with neither summary nor encrypted content is omitted from the provider request. Completed signed reasoning remains replayable. | [#53603](https://github.com/anomalyco/opencode/pull/53603), merged        |
| MCP names           | Remove registry-wide tool-name and namespace length caps while retaining nonempty names, valid characters, and reserved-name checks.                                                                                                                 | [#53586](https://github.com/anomalyco/opencode/pull/53586), merged        |
| MCP input ownership | Carry the calling Session into form and URL elicitations and cancel pending input when the call ends or is interrupted.                                                                                                                              | [#53608](https://github.com/anomalyco/opencode/pull/53608), open proposal |
| Summary compaction  | Keep tool definitions and the request history prefix but force `toolChoice: none` on the summary request and its retries. Provider cache behavior still depends on this request shape.                                                               | [#53370](https://github.com/anomalyco/opencode/pull/53370), open proposal |
| TUI attention       | Show permission/question markers instead of a working spinner and prioritize sessions needing input in Open and Sessions. Include known child-session input in the parent's status.                                                                  | [#53435](https://github.com/anomalyco/opencode/pull/53435), merged        |

MCP connections remain Location-scoped. Correlated HTTP requests retain their
Session context; legacy stdio or standalone SSE may use the sole in-flight call.
Concurrent requests without enough correlation are cancelled rather than
attributed to an arbitrary Session. Unsolicited requests retain the existing
Location owner. This is not full concurrent elicitation support for every legacy
transport.

Regression contracts exercise real loopback HTTP and stdio MCP servers, isolated
form replies/cancellation/interruption, long tool names through native and Code
Mode execution, Responses request lowering, compaction requests, and rendered
TUI menus. The tool registry suite is now part of the Redcode CI contracts.

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

## Monitor progress and reasoning observation

V2 monitor tools observe HTTP endpoints, files and processes. Each check still
persists through the existing SQLite record. `monitor.progress` carries only the
latest saved running snapshot, coalesced every two seconds and bounded to the
existing 8,000-character evidence tail. It does not create inbox items, wake a
Session or call a model. Final results keep their existing idempotent admission
and origin checks, including paused goals and newer user instructions.

The TUI applies these snapshots to the existing summary and evidence rows.
Terminal monitors remain absent from the active drawer; old snapshots cannot
bring them back. Reconciliation polling remains available if an event is missed.
Streaming output from background shell commands retains its separate shell
contract; this change does not add shell commands to the monitor tool.

Reasoning repetition detection runs passively inside each physical attempt.
It keeps bounded state and emits at most one structured diagnostic per attempt,
containing only detection metadata and counters. It does not record excerpts or
fingerprints, change retries, truncate output, interrupt generation or present an
observation as a guard intervention.

From `packages/core`, `bun run script/reasoning-observation-eval.ts --check`
evaluates a versioned synthetic corpus without inference. CI runs it alongside
the contract tests. Its confusion matrix and chunk-splitting checks describe this
corpus only; they do not establish accuracy on real coding sessions. Connecting
detection to interruption requires a separately evaluated policy.

The corpus explicitly counts a known false positive: periodic text inside a
quotation that starts after ordinary prose on the same line. Prefix-based syntax
exclusions do not parse arbitrary inline quotations. The check pins that reviewed
limitation and rejects new unexpected outcomes; it does not require or report
perfect accuracy. Detection overhead in real sessions has not been measured.

## Follow-up decisions

| Proposal                                                                        | Decision and dependency                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Incremental monitors #52569](https://github.com/anomalyco/opencode/pull/52569) | Native probe progress is adapted to `MonitorRuntime`. Shell streaming remains a separate integration; a future expansion must retain vault capture, process ownership and terminal admission instead of replacing them with the proposal's KV service.                                                                                            |
| [Reasoning repetition #52669](https://github.com/anomalyco/opencode/pull/52669) | Passive bounded observation is implemented. Hard stream truncation stays deferred: calibrate false positives against real session evidence before connecting detection to Core interruption, preserving signed completion metadata.                                                                                                               |
| [Per-session cleanup #51583](https://github.com/anomalyco/opencode/pull/51583)  | Do not combine its expiry policy with the pending-human-response fix: a quiet unanswered form is legitimate waiting. Keep process cleanup and human-response admission separate.                                                                                                                                                                  |
| [Effect RcMap #52635](https://github.com/anomalyco/opencode/pull/52635)         | Evaluate separately with a repeated reload/disposal reproduction. A dependency identity fix alone does not prove reported CPU or leaked-process symptoms are solved.                                                                                                                                                                              |
| Catalog metadata integrity                                                      | The updater checks structure and snapshot completeness. Cross-field limits, capabilities and service-tier semantics need separate validation; catalog presence is not proof of provider behavior. Track [models.dev #6073](https://github.com/anomalyco/models.dev/issues/6073) and [#5792](https://github.com/anomalyco/models.dev/issues/5792). |

## October 7 Design source references and lint

Adapted the generated-reference and deterministic-lint ideas from
[OpenCode draft PR #53485](https://github.com/anomalyco/opencode/pull/53485)
to each application's own design system. The generated block of `.red/DESIGN.md`
now lists observed CSS custom-property names with source lines, and token and
component source files with SHA-256 hashes. Refresh updates that block while
preserving handwritten guidance and Notes. Configured stylesheets are included
in discovery even outside the conventional `src` paths; this does not adopt a
system or grant permissions automatically.

The existing revision audit includes two advisory rules:

- `design/prefer-color-token`: a single literal CSS color has an exact equivalent
  in an observed project custom property. The suggested token must still match
  the semantic role; equality of colors does not establish that role.
- `design/no-solid-line-height`: `line-height: 1`, `1.0`, `100%` or `1em` warrants
  reviewing the actual glyphs. It is a possible clipping risk, not proof of clipping.

Lint reads the published source blobs and the revision's observed token excerpts,
so later draft edits or refreshed discovery do not rewrite historical evidence.
Findings carry source paths, lines and stable keys. A CSS comment on the same
line or immediately above can record a reasoned exception, for example
`/* design-lint-allow design/no-solid-line-height: reviewed icon glyph */`.
These exceptions remain visible as informational evidence. Existing explicit
`accept:<key>` Design decisions also apply.

Coverage is deliberately bounded: CSS files and actual `<style>` elements in
HTML, Vue and Svelte; up to 200 revision files, 256 KB per file and 4 MB total.
At most 20 findings per rule are recorded; excess findings are counted.
Token evidence comes from discovery's first 20 excerpts, at most 12,000 bytes
each; the manifest lists at most 100 token names per file. Only complete
declarations contribute evidence. JSX style objects, inline HTML style
attributes, Tailwind utilities, imported stylesheets and TypeScript/JSON token
registries are outside these new rules. They remain available to existing
reuse checks or manual review. Literal equivalence preserves alpha and does
not try to normalize different color representations.

Automatic reviews remain report-only and manual anti-slop retains its single
bounded correction/publication/final-audit contract. No new CI failure baseline,
theme-selector policy, legacy-token registry or RTL policy is imposed on the
user's project. Those upstream rules require explicit project conventions before
they can be adopted safely.

## Validation gate

The Redcode workflow runs canonical lint/typecheck, generated-client drift,
offline snapshot verification and the selected Linux/Windows contracts.
Regressions exercise real protocol parsing, loopback MCP servers, Session
settlement/export, Location cleanup and service restart fixtures. Provider
recordings replay by default and require no paid inference.

CI completion is required before reporting validation. No provider credential
smoke, new benchmark, installed-service restart or release is implied by this
implementation.
