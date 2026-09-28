# Redcode migration contract

Redcode remains the product. OpenCode V2 supplies the new technical foundation.
The migration must preserve the behavior and experience of Redcode before the
migration, including its improvements over upstream. Upstream defaults do not
replace Redcode product decisions.

## Reference

Use the pre-migration Redcode history at
`8542747fc2b4e6589742358e10f8f2a38baa4820` (`b270378237^2`) when comparing
features, interactions, configuration, and documentation. Compare current work
against `main`; keep development on `main`.

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

| Redcode contract                                                  | Current V2 integration                                                                          | Status / remaining work                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Startup, `/new`, `/clear` open real blank sessions                | `tui/src/routes/home.tsx` uses the V2 session data layer; explicit resume/fork stays separate   | Restored; route regression tests in CI                                                                     |
| Redcode palette and stable primary-agent colors                   | Native light/dark `redcode.json`, default theme selection, fixed categorical agent mapping      | Restored; custom themes remain selectable                                                                  |
| Right sidebar Context / Workers / Subagents                       | `routes/session/sidebar.tsx`; Workers reuses the production worker component and APIs           | Restored; narrow and wide fixtures                                                                         |
| Persisted tasks, blockers and recent completed work               | `SessionTodoStore` → `session.todo.list` → generated clients → `SidebarTodo`                    | Restored; no second task store                                                                             |
| Goal dialog and old `/goal-*` controls                            | Existing V2 Goal service, plus compatibility commands dispatching to the same controller        | Restored; token/cost budget parity still requires separate comparison                                      |
| S1/S2 and JEV                                                     | `core/intelligence`, `/setup`, `/intelligence`, evaluation history and footer                   | Implemented; real provider evaluation journey not verified in this audit                                   |
| Design workflow                                                   | `core/design`, server Design handlers, `/design`, `/design-open`, `/design-review`              | Implemented; browser feedback/approval/handoff journey still needs end-to-end parity verification          |
| Question mode                                                     | `core/plugin/question.ts` and read-only permissions                                             | Implemented; preserve no-code-change contract and Build → Plan → Design → Question cycle                   |
| Voice dictation                                                   | `tui/src/context/voice-input` and composer integration                                          | Existing CI contract; real dictation client still needs verification                                       |
| Hook configuration/trust/import and `/hooks`                      | V2 plugin hooks exist, but the old user-configured hook lifecycle and dialog are not equivalent | Missing integration; port trust fingerprint, import, runtime dispatch and UI together                      |
| `/monitors` management                                            | Existing core monitor service → session monitor API → generated client → `/monitors`            | Restored list, live status, bounded result and local cancellation; CI covers API isolation and TUI actions |
| Sidebar files and LSP                                             | Native V2 session diff and location LSP APIs → restored sidebar plugins                         | Restored; files remain session-specific, LSP follows the session location                                  |
| Context latency/throughput and session budget display             | Current sidebar exposes context usage and cost only                                             | Missing historical metrics/budget UI; preserve real timing semantics, do not estimate fake token rates     |
| Provider connection and discovered-model persistence              | Native provider adapters and RedRouter integration exist                                        | Compare the previous OpenAI-compatible/9Router wizard, refresh and model-catalog persistence behavior      |
| Existing configuration, workspace behavior, CLI/RPC and migration | V2 configuration/migration paths and legacy RPC adapter exist                                   | Full command/configuration compatibility inventory still required                                          |

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
