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

| Redcode contract                                                  | Current V2 integration                                                                                           | Status / remaining work                                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup, `/new`, `/clear` open real blank sessions                | `tui/src/routes/home.tsx` uses the V2 session data layer; explicit resume/fork stays separate                    | Restored; route regression tests in CI                                                                                                                                                                                                                |
| Redcode palette and stable primary-agent colors                   | Native light/dark `redcode.json`, default theme selection, fixed categorical agent mapping                       | Restored; custom themes remain selectable                                                                                                                                                                                                             |
| Context sidebar plus Workers / Subagents activity drawer          | `routes/session/sidebar.tsx`; composer tabs reuse the production worker and V2 subagent APIs                     | Context keeps historical widths; `/workers` and `/subagents` open the bottom drawer, with detailed management still reachable                                                                                                                         |
| Persisted tasks, blockers and recent completed work               | `SessionTodoStore` → `session.todo.list` → generated clients → `SidebarTodo`                                     | Restored; no second task store                                                                                                                                                                                                                        |
| Goal dialog and old `/goal-*` controls                            | Existing V2 Goal service, plus compatibility commands dispatching to the same controller                         | Restored, including step, cost and token budgets measured from Goal start                                                                                                                                                                             |
| `/pending` prompt management                                      | V2 durable inbox list, delivery update and cancellation APIs                                                     | Restored for queued and steering prompts, including empty state, send-now, discard and discard-all                                                                                                                                                    |
| S1/S2 and JEV                                                     | `core/intelligence`, `/setup`, `/intelligence`, evaluation history and footer; separate S2 transformations model | Saved S2 roles can be reused; setup chooses provider then model. Names and router origins are visible without changing selected model IDs. Real provider evaluation journey and non-compaction transformation parity remain unverified                |
| Design workflow                                                   | `core/design`, server Design handlers, `/design`, `/design-open`, `/design-review`                               | Implemented; browser feedback/approval/handoff journey still needs end-to-end parity verification                                                                                                                                                     |
| Question mode                                                     | `core/plugin/question.ts` and read-only permissions                                                              | Implemented; preserve no-code-change contract and Build → Plan → Design → Question cycle                                                                                                                                                              |
| Voice dictation                                                   | `tui/src/context/voice-input` and composer integration                                                           | Existing CI contract; real dictation client still needs verification                                                                                                                                                                                  |
| Hook configuration/trust/import and `/hooks`                      | Restored native declarative hook service, config normalization, authenticated API, generated client and `/hooks` | Trust/import and lifecycle wiring implemented; command execution, prompt rejection/idempotence and TUI confirmation covered by the CI contract suite                                                                                                  |
| `/monitors` management                                            | Existing core monitor service → session monitor API → generated client → `/monitors`                             | Restored list, live status, bounded result and local cancellation; CI covers API isolation and TUI actions                                                                                                                                            |
| Sidebar files and LSP                                             | Native V2 session diff and location LSP APIs → restored sidebar plugins                                          | Restored; files remain session-specific, LSP follows the session location                                                                                                                                                                             |
| Subagent sidebar actions and model details                        | `routes/session/subagent.tsx` → V2 child prompt admission and interruption                                       | Open/steer/kill restored with confirmation and API-target regression; historical review badges/brief/checkpoint summaries still need adaptation                                                                                                       |
| Context latency/throughput and session budget display             | V2 session and descendant accounting powers `/budget`, Goal budgets and the Context sidebar                      | Cost/token budget display and pre-step enforcement restored; historical real timing metrics remain                                                                                                                                                    |
| Provider connection and discovered-model persistence              | Native provider adapters plus RedRouter and 9Router integrations discover and cache models                       | Both routers ask for an endpoint; the router catalog's owner and aliases plus bundled models.dev names feed model labels. Flat IDs are not assigned an origin from their prefix. The arbitrary OpenAI-compatible multi-provider wizard remains absent |
| Existing configuration, workspace behavior, CLI/RPC and migration | V2 configuration/migration paths and legacy RPC adapter exist                                                    | Full command/configuration compatibility inventory still required                                                                                                                                                                                     |

The default CI runner includes the restoration journeys in
`test/redcode-session.test.tsx`, `test/redcode-theme.test.ts`,
`test/redcode-workflows.test.tsx` and authenticated task/monitor API contracts.
Run these through GitHub Actions; do not run local tests for this migration.
A green result for these cases does not close the missing rows above.

## Completion gate

A successful build or a restored logo alone does not establish migration parity.
Track missing behavior explicitly, validate the restored user journeys, and run
the existing checks and tests in CI against the actual restoration commit before
publishing through the existing `redcode` workflow. Do not describe all previous
features as preserved until the comparison and behavioral validation support it.
