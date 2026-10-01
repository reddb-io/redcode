# Redcode migration contract

Redcode remains the product. OpenCode V2 supplies the new technical foundation.
The migration must preserve the behavior and experience of Redcode before the
migration, including its improvements over upstream. Upstream defaults do not
replace Redcode product decisions.

## Reference

The product and visual reference is **Redcode v0.57.0**, released Friday,
September 25, 2026, at 15:08 -03 (`0dcec730fd`). Preserve that version's colors,
layout, interactions and features while adapting their implementation to V2.

The later integration history at `8542747fc2b4e6589742358e10f8f2a38baa4820`
(`b270378237^2`) is supporting migration evidence, not a replacement for the
released Redcode experience. Compare current work against `main`; keep
all development on `main`.

For side-by-side source inspection, the local reference checkout is
`../redcode-reference-0.57`, detached at tag `v0.57.0`
(`0dcec730fd8a8a2669bba4e86c1b176dd426d755`). It has no dependency installation
and is not used by builds, tests or runtime. Keep it unchanged. Recreate it with:

```sh
git clone --depth 1 --single-branch --branch v0.57.0 git@github.com:reddb-io/redcode.git ../redcode-reference-0.57
```

Compare the historical and current implementations by user journey, not by
copying the old runtime. For example, the old `routes/session/subagent.tsx`
exposes open/steer/kill actions; the V2 adapter must call prompt admission with
`delivery: "steer"` and `session.interrupt` for the selected child, keeping
the child's existing model and agent selection.

The command comparison also found `/thinking` redirected to model effort. It is
restored as the historical reasoning display toggle; `/variants` and `/effort`
retain model effort selection. `/context`, `/subagents` and `/timestamps` are
restored to their existing V2 controllers. The `goal-*` aliases are registered
dynamically. `/pending` again lists queued and steering prompts and supports
send-now, discard and discard-all through V2 inbox APIs. `/budget` still requires
adapted to V2 session and Goal accounting, including descendant usage.

## Experience to preserve

- Redcode product identity throughout launch, the terminal, setup, and updates.
- S1/S2 setup, explicit model roles, effective configuration, evaluation history,
  and visible unavailable or inconclusive evaluator states.
- Design as an integrated workflow: start, resume, browser review, feedback, and
  handoff to implementation.
- Question as an investigative, read-only mode; the primary agent cycle remains
  Build → Plan → Design → Question → Build.
- Voice dictation into the current composer, preserving attachments and drafts,
  without submitting the prompt automatically.
- Existing Redcode commands, configuration, sessions, goals, and integrations.

## Adaptation rule

The starting product is the pre-migration Redcode. For each Redcode behavior,
keep its user contract and adapt the implementation to V2 Schema, Core,
Protocol, Server, Client and TUI boundaries. A feature that still exists in a
source file but has lost its command, API, persistence or UI path is not migrated.
Do not substitute upstream defaults for an existing Redcode feature.

## Restoration audit (2026-09-28)

Historical UX is also reproducible at tag `v0.57.0`. The table distinguishes
implemented paths from identified gaps; it is not a full-parity declaration.

| Redcode contract                                                  | Current V2 integration                                                                                           | Status / remaining work                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup, `/new`, `/clear` open real blank sessions                | `tui/src/routes/home.tsx` uses the V2 session data layer; explicit resume/fork stays separate                    | Restored; route regression tests in CI                                                                                                                                                                                                                                                                                                                                                                  |
| Redcode palette and stable primary-agent colors                   | Native light/dark `redcode.json`, default theme selection, fixed categorical agent mapping                       | Restored; custom themes remain selectable                                                                                                                                                                                                                                                                                                                                                               |
| Context sidebar plus Workers / Subagents activity drawer          | `routes/session/sidebar.tsx`; composer tabs reuse the production worker and V2 subagent APIs                     | Context keeps historical widths; `/workers` and `/subagents` open the bottom drawer, with detailed management still reachable                                                                                                                                                                                                                                                                           |
| Persisted tasks, blockers and recent completed work               | `SessionTodoStore` → `session.todo.list` → generated clients → `SidebarTodo`                                     | Restored; no second task store                                                                                                                                                                                                                                                                                                                                                                          |
| Goal dialog and old `/goal-*` controls                            | Existing V2 Goal service, plus compatibility commands dispatching to the same controller                         | Restored, including step, cost and token budgets measured from Goal start                                                                                                                                                                                                                                                                                                                               |
| `/pending` prompt management                                      | V2 durable inbox list, delivery update and cancellation APIs                                                     | Restored for queued and steering prompts, including empty state, send-now, discard and discard-all                                                                                                                                                                                                                                                                                                      |
| S1/S2 and JEV                                                     | `core/intelligence`, `/setup`, `/intelligence`, evaluation history and footer; separate S2 transformations model | Saved S2 roles can be reused; setup chooses connection then model and saves the connection identity. Names and router origins are visible without changing selected model IDs. Fresh connection discovery, S2 generation, S1 decision probing and restart persistence verified with a CI-built candidate; comparative dual reasoning and non-compaction transformation parity remain unverified         |
| Design workflow                                                   | `core/design`, server Design handlers, `/design`, `/design-open`, `/design-review`                               | Implemented; browser feedback/approval/handoff journey still needs end-to-end parity verification                                                                                                                                                                                                                                                                                                       |
| Question mode                                                     | `core/plugin/question.ts` and read-only permissions                                                              | Implemented; preserve no-code-change contract and Build → Plan → Design → Question cycle                                                                                                                                                                                                                                                                                                                |
| Voice dictation                                                   | `tui/src/context/voice-input` and composer integration                                                           | Existing CI contract; real dictation client still needs verification                                                                                                                                                                                                                                                                                                                                    |
| Hook configuration/trust/import and `/hooks`                      | Restored native declarative hook service, config normalization, authenticated API, generated client and `/hooks` | Trust/import and lifecycle wiring implemented; command execution, prompt rejection/idempotence and TUI confirmation covered by the CI contract suite                                                                                                                                                                                                                                                    |
| `/monitors` management                                            | Existing core monitor service → session monitor API → generated client → `/monitors`                             | Restored list, live status, bounded result and local cancellation; CI covers API isolation and TUI actions                                                                                                                                                                                                                                                                                              |
| Sidebar files and LSP                                             | Native V2 session diff and location LSP APIs → restored sidebar plugins                                          | Restored; files remain session-specific, LSP follows the session location                                                                                                                                                                                                                                                                                                                               |
| Subagent sidebar actions and model details                        | `routes/session/subagent.tsx` → V2 child prompt admission and interruption                                       | Open/steer/kill restored with confirmation and API-target regression; historical review badges/brief/checkpoint summaries still need adaptation                                                                                                                                                                                                                                                         |
| Context latency/throughput and session budget display             | V2 session and descendant accounting powers `/budget`, Goal budgets and the Context sidebar                      | Cost/token budget display and pre-step enforcement restored; historical real timing metrics remain                                                                                                                                                                                                                                                                                                      |
| Provider connection and discovered-model persistence              | Native provider adapters plus RedRouter and 9Router integrations discover and cache models                       | Both routers ask for an endpoint; owner and aliases plus bundled models.dev names feed labels. Router model parameters determine limits, modalities, tools and declared reasoning levels; native providers retain their own adapters. Flat IDs are not assigned an origin from their prefix. The OpenAI-compatible wizard discovers models and limits and saves a separate integration for the endpoint |
| Existing configuration, workspace behavior, CLI/RPC and migration | V2 configuration/migration paths and legacy RPC adapter exist                                                    | Full command/configuration compatibility inventory still required                                                                                                                                                                                                                                                                                                                                       |

The default CI runner includes the restoration journeys in
`test/redcode-session.test.tsx`, `test/redcode-theme.test.ts`,
`test/redcode-workflows.test.tsx` and authenticated task/monitor API contracts.
Run these through GitHub Actions; do not run local tests for this migration.
A green result for these cases does not close the missing rows above.

## Connection and recovery contracts

New model selections preserve a credential ID or environment-variable identity in `Model.Ref.connection`. Legacy references without that field remain readable and use the integration's active access. S2 setup and session selections carry the identity through the TUI, durable session events, projection and resolution. A removed or expired selected connection fails explicitly rather than borrowing the active account. RedRouter and 9Router selections read the persisted catalog belonging to the selected endpoint and key, including models absent from the active account's catalog.

Older persisted raw catalogs are normalized before publishing their models, including when a refresh fails. CI covers connecting after an empty startup, persisting all chunks of a 205-model catalog, disposing and recreating the router adapter with the same durable storage while the router returns HTTP 503, and upgrading a raw-only catalog without a successful network request. These are adapter lifecycle contracts, not a full fresh-install journey.

Native compaction provenance includes a digest of the selected access identity. A checkpoint from another account is incompatible even when model and endpoint match; text summaries retain their existing behavior. Goals recovered from another process pause and require explicit resume. Monitor results respect that pause and newer user instructions.

The required CI selection includes model resolution, session creation/persistence, monitor origin and MCP lifecycle, OAuth and instructions. Credentialed end-to-end journeys and comparative single/dual reasoning evaluations still require separate validation. Catalog tests report catalog availability explicitly; `/setup` tests the selected generation and decision roles.

Authenticated catalog probes against the installed local RedRouter on 2026-09-30 returned:

| Route                              | HTTP status | Duration | Response bytes | Models |
| ---------------------------------- | ----------- | -------- | -------------- | ------ |
| `/v1/models?capabilities=chat`     | 200         | 622 ms   | 480,011        | 934    |
| `/v1/models?capabilities=decision` | 200         | 260 ms   | 380            | 1      |

The decision entry was `openrouter/typesafe/jev-1.13`, with `type: "systemone"`, `capabilities.decision: true` and advertised `systemone`/`decisions` endpoints. The unfiltered and legacy decision catalogs also returned HTTP 200. This snapshot verifies authenticated remote discovery; it does not verify generation, decision execution or a freshly installed Redcode client.

## Fresh connection runtime verification (2026-09-30)

An isolated home and Git project running the CI-built 0.70.2 candidate from
`c7945ac961` connected to the installed RedRouter with an explicit endpoint and
stored credential. The catalog populated with 934 generative models and one
System One model. Production API probes returned:

| Selected role | Model                          | Remote route           | HTTP status | Duration | Response bytes |
| ------------- | ------------------------------ | ---------------------- | ----------- | -------- | -------------- |
| S2            | `auto/best-fast`               | `/v1/chat/completions` | 200         | 8,069 ms | 61,299         |
| S1            | `openrouter/typesafe/jev-1.13` | `/v1/systemone`        | 200         | 660 ms   | 222            |

S2 returned `OK`; S1 passed the decision probe. After restarting the isolated
managed service, its port remained 35555, the catalog contained the same 934
models, and the reasoning settings plus the created Session retained their
selected credential IDs. The check waited for Location plugin activation before
reading the restarted catalog. Session creation adds the default variant; the
persistence assertion compares the selected model and connection independently
of that default.

The 0.70.1 artifact reproduced a setup defect: generation checks ignored the
client's `location[directory]` query and resolved the selected connection against
the base configuration instead of the project. The candidate uses the same
request Location resolver as other project endpoints and waits for plugin
activation. The server regression is now required by `script/test-redcode.ts`
and passed on Linux and Windows in CI.

This validates discovery, one-shot generation, decision probing and durable
selection through the production APIs; it does not establish full interactive
TUI onboarding or comparative single/dual reasoning behavior. The initial 0.70.1 publication stopped on a staged Windows ARM64 package.
The subsequent 0.70.2 publication completed; its final archive and npm install
were independently verified as recorded below.

## Single and dual Session runtime verification (2026-09-30)

Two isolated Build Sessions used the same saved RedRouter connection and
`auto/best-fast`, with tool permissions denied, for a small arithmetic request.
Both reached `outcome: "succeeded"` and returned `4`.

| Mode   | End-to-end duration | S2 input / output tokens | Persisted S1 evaluations                  |
| ------ | ------------------- | ------------------------ | ----------------------------------------- |
| Single | 6,098 ms            | 378 / 5                  | None                                      |
| Dual   | 5,093 ms            | 628 / 5                  | Prompt classification and response review |

The dual classification was inconclusive for `change_kind` and `design_target`;
the advisory classifier preserved that result rather than blocking the request.
The response review was accepted with no issues. Together, the S1 calls reported
5,018 input tokens and 467 output tokens. This small sample verifies that the
Session runner invokes and persists S1 in dual mode and omits it in single mode;
it is not a speed or quality benchmark, since automatic routing can select
different upstream models.

The live evidence exposed missing S1 budget accounting: the Session's projected
S2 token counters held 633 tokens, while the S1 evaluation rows held another
5,485. Session and Goal budget totals now fold those existing evaluation rows,
including descendant Sessions, without creating duplicate usage events or
changing model-visible steps. Evaluation records have no monetary price, so
budget totals mark their usage as unpriced rather than assuming it is free.
The required database regression covers descendant isolation, repeated reads,
Goal baseline subtraction, unknown pricing, and parent budget enforcement.

## Redcode 0.70.2 release verification (2026-09-30)

The [release workflow](https://github.com/reddb-io/redcode/actions/runs/36806030244)
completed successfully. Public tags `v0.70.2` and `design-v0.70.2` both point to
`cff6d7ac471a970fdb09563f4842c45ec47e1c5a`; their releases contain 13 and 15
assets respectively. CI verified all archive checksums and installed the exact
npm version. The main package, its `latest` tag, and all twelve platform packages
are available at 0.70.2; a direct main-package tarball fetch returned HTTP 200.

Independent local verification checked the final Linux archive checksum and a
fresh npm installation. That installation discovered 934 generative models and
one decision model, generated `OK` through S2, passed the S1 probe, and retained
its catalog plus selected connection identities after restarting. Both remote
probes returned HTTP 200 with latency and complete response-byte diagnostics.
Temporary credential storage was removed after the check.

The mise-managed installation was upgraded to 0.70.2. Its normal managed service
responded at `http://127.0.0.1:35555/api/info` with HTTP 200 and version 0.70.2;
the process executable belongs to the mise 0.70.2 installation.

The evaluator-budget correction at `5f9f824ff3` is subsequent work on `main`,
with Linux/Windows contracts and full lint/typecheck passing in
[CI](https://github.com/reddb-io/redcode/actions/runs/36806522678). Its Changeset
is pending the next patch release; it is not part of the 0.70.2 tag.

## Completion gate

A successful build or a restored logo alone does not establish migration parity.
Track missing behavior explicitly, validate the restored user journeys, and run
the existing checks and tests in CI against the actual restoration commit before
publishing through the existing `redcode` workflow. Do not describe all previous
features as preserved until the comparison and behavioral validation support it.
