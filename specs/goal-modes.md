# Goal, Plan and Design continuity

Implements the P0/P1 priorities from `.red/researches/2026-09-07-goal-modes-comparison.md` on the existing Session runner. Goal does not introduce a second execution coordinator.

## Contract

- SessionV2 persists the objective, criteria, gates, scope, budget, status, measured tokens, evidence hashes and executed checks in SQLite. A provider attempt consumes one turn, including the first attempt. Auxiliary verification usage is included when reported by the provider. Exhaustion pauses; it never completes the objective.
- `goal_complete` reads actual text artifacts, checks unfinished todos and Design jobs, executes configured gates, requests a bounded independent review and proposes completion. The runner defers this tool until ordinary sibling tools and their hooks settle, then finalizes the proposal after all tool effects: it rereads artifacts, rechecks pending work and commits through compare-and-swap. Changed files, new steering, newly pending work, a replaced goal, pause or budget changes invalidate completion. The final SQLite update atomically rejects an unpromoted steer; an explicitly queued follow-up remains separate. Recorded checks and evidence are visible in the App.
- Completion proposals are bounded process-local state and are discarded on interruption or drain completion. They do not introduce a durable execution identity or automatic recovery. Independent review receipts are durable and idempotent; their usage survives a rejected verdict, pause or replacement of the current Goal. Usage updates do not change the control revision or restore stale state. Primary usage already reported by the provider is charged once before turn exit, including failure and interruption.
- `gate:` clauses in the Goal dialog become executable checks; the remaining clauses stay in the objective supplied to the reviewer. Gates obey shell permissions, including in Plan and Design.
- A goal starts in the selected mode. Its default endpoint is that mode. The App's explicit execution option authorizes Build within the same objective. Mode transitions never expand the objective.
- `plan_exit` reads a nonempty file and records its SHA-256 revision and contents. A Plan-only goal records readiness without entering Build. Other transitions require approval or explicit Goal execution authorization. The approved snapshot remains in Session system context after compaction; a later draft does not replace it.
- Goal updates send concise status/budget context without appending the full approved plan again. The App preserves opened plan revisions during polling, including when a new draft appears, and refreshes after mutations even if an older status read is pending.
- Plan permits research and editing plan files. Design permits research and editing prototype work directories. Shell and unclassified external tools are denied by default. User-configured permissions still apply. Image adapters retain their named permissions even when called through `design_generate`; configure the named adapter explicitly.
- Design approval freezes audit findings and exercised scenarios for that exact revision. Repeating an approval keeps the original evidence. `completed` is a job state, not a clean audit or visual approval.
- Rendering distinguishes queued/running/terminal jobs. Browser installation, connection, rendering and cleanup have deadlines. Cancel interrupts the owned job and closes/kills the owned browser server. SVG is the editable animation source; GIF is an export.
- A new process pauses an active Goal instead of automatically retrying provider work. Waiting on Design jobs spends no new provider turn. In this version, the operator explicitly resumes the Goal after the jobs finish.

## Legacy compatibility

The TUI's legacy session runtime remains distinct from SessionV2. Its budget unit is a turn: one full agent turn ending in a judge cycle. Tool round-trips inside a turn and provider retries under it are steps of that turn and spend nothing; the step ceiling, loop guard and retry policy bound them. A turn that ends waiting on background work spends nothing either. It skips gates/judging while background work runs, includes the current turn's recorded tool outputs and real gate results in judging (gate results are kept ahead of tool output when the evidence is cut to size), and rejects completion based on a textual claim alone. Terminal provider failure blocks the Goal. A turn ended by the step ceiling or the stall watchdog pauses the Goal with that reason; a Goal record changed by `/goal-budget` or `/goal-resume` while the judge was deciding is decided again on the fresh record, and paused if it changes again. Exhausted resume remains paused until `/goal-budget` increases the budget. Plan uses the same default restrictions and reads/hashes the plan before approval. A Goal started in Plan stays there; the composer changes mode only from explicit authorized transition metadata.

[`redcode design`](design/terminal.md) provides a separate interactive SessionV2 terminal with durable history, mode controls, permissions, questions and browser review. The legacy full-screen TUI exposes its launcher; legacy session IDs are not adopted as V2 sessions.

The legacy runtime does not acquire SessionV2's evidence-table/CAS guarantees. Its guard against a late judge checks goal identity, status and update time; durable revisions and the App's evidence history belong to SessionV2. Legacy sessions own `session_context_epoch` and `session_message` system rows for their Baseline System Context and `session_input` rows (durable prompt admission with `steer`/`queue` delivery, promoted by the legacy loop itself) but are never run by `SessionRunner`.

## Validation

Run checks from the package directories, never the repository root:

```sh
# packages/core
bun test test/session-goal.test.ts test/tool-goal-plan.test.ts test/goal-runner.test.ts test/session-runner.test.ts test/agent.test.ts
PLAYWRIGHT_BROWSERS_PATH=/path/to/installed/browsers bun test test/design.test.ts
bun typecheck
bun script/migration.ts --check

# packages/redcode
bun test --timeout 30000 test/session/goal.test.ts test/session/prompt.test.ts -t '^(a CONTINUE|the turn budget|BLOCKED|a failing gate|goal_complete|an unreadable judge|a goal driven|a goal,|a Plan-only|the decision|what the model|reading the judge|one line)'
bun test test/agent/agent.test.ts
bun typecheck

# packages/server, with isolated Core preload
PLAYWRIGHT_BROWSERS_PATH=/path/to/installed/browsers bun test --preload ../core/test/preload.ts test/session-goal.test.ts test/design-review.test.ts
bun typecheck

# packages/app
bun run test:e2e smoke/session-goal.spec.ts
bun run test:bench timeline/session-tab-switch-benchmark.spec.ts
bun typecheck
```

The browser cache must be supplied explicitly because the Core test preload changes the home/cache directories. Otherwise the first Design test downloads Chromium into an isolated cache and may time out before rendering begins.

Fixtures verify orchestration, storage, permissions and browser behavior. They do not measure model planning ability, visual judgment or paid asset-generation quality. Real-model evaluation should use the scenarios below before claiming a quality improvement.

### Prior implementation validation

The implementation preceding the CLI reliability audit recorded 220 passing tests. This is a historical result, not the validation count for the subsequent fixes; see [CLI reliability](cli-reliability.md) for their tests and limits.

| Area                                            | Passing tests | Coverage                                                                                                                     |
| ----------------------------------------------- | ------------: | ---------------------------------------------------------------------------------------------------------------------------- |
| Core runner, Goal state, tools and agent policy |           115 | Durable continuation, provider failures, turn limits, approved-plan context, stale reviews, pending work and mode boundaries |
| Design renderer and storage                     |             8 | Real Chromium, React/Solid, SVG-to-GIF decoding, cancellation and immutable audit evidence                                   |
| Legacy Goal and Plan runtime                    |            25 | Turn budgets, observed evidence, waiting and Plan-only completion                                                            |
| Legacy agent policy                             |            44 | Effective permissions and overrides                                                                                          |
| Legacy registry and embedded V2 API             |            20 | Tool availability and embedded service wiring                                                                                |
| Server Goal API and Design review               |             6 | Durable admission/control and browser review                                                                                 |
| App browser journeys                            |             2 | Start, pause, resume, budget, evidence, opened plan preservation, session isolation and a pending-read race                  |

Core, Server, Design, legacy Redcode and App typechecks passed, including App E2E typechecking. Core migration consistency, public Client generation and legacy SDK generation passed. Browser journeys use deterministic API fixtures; the Server suite checks actual HTTP handlers separately.

### Production interface benchmark

The existing session-tab benchmark ran serially against production builds, with five samples per scenario (30 before and 30 after). Both runs recorded zero blank samples and zero wrong-destination samples. Values below are medians in milliseconds:

| Layout and scenario             | First correct before | First correct after | Stable before | Stable after |
| ------------------------------- | -------------------: | ------------------: | ------------: | -----------: |
| Legacy layout, cold             |                 91.4 |                38.0 |         205.2 |         91.9 |
| Legacy layout, hot              |                 33.1 |                15.7 |          86.9 |         49.8 |
| New layout, review closed, cold |                150.0 |                96.9 |         192.1 |        137.1 |
| New layout, review closed, hot  |                 46.0 |                16.3 |         118.7 |         56.8 |
| New layout, review open, cold   |                136.3 |               106.9 |         220.7 |        127.8 |
| New layout, review open, hot    |                 75.7 |                70.0 |         121.2 |        115.1 |

No latency increase was observed in this run. These measurements do not establish a speedup caused by the change: the shared host had unrelated compilation/workloads and was not load-controlled between runs. The fixture measures interface navigation without an active Goal; it does not measure provider latency, active-Goal polling or render-job throughput.

Raw local records are retained in `/tmp/redcode-goal-baseline.log`, `/tmp/redcode-goal-benchmark-final.log` and `/tmp/redcode-goal-benchmark-comparison.json`. The final measurement used an already-built preview on port 4553 with the benchmark's web-server startup disabled; its scenarios, sample counts and probes were unchanged.

## Model evaluation scenarios

For each run record the model/variant, objective, budget, final status, time to first useful artifact, reported tokens including review, human corrections, verified criteria and remaining blockers.

1. **Plan only:** inspect a small real repository, produce an executable plan with concrete checks, and stop in Plan. Confirm product files are unchanged and the recorded revision is sufficient for a fresh session.
2. **Reviewed design:** prototype a checkout in Design, exercise populated/empty/error states at 390/768/1440 px, review findings, approve a revision and inspect the same evidence in Plan.
3. **SVG to GIF:** create an editable animated SVG, export a GIF, decode its frames/dimensions/timing and cancel another export while retaining shell control.
4. **Approved execution:** explicitly authorize implementation, approve the plan, implement its exact scope, run checks and complete using actual evidence. Modify one artifact during review and verify rejection.
5. **Interruption:** interrupt a provider turn, resume in the same Session, then simulate process replacement. Confirm the transcript and plan survive and provider work restarts only after explicit resume.

GIF encoding and image comparison now run in a bounded, cancelable Worker. Automatic learning of preferences and automatic job-driven Goal resumption remain separate follow-ups. No memory writing or performance/quality claim is implied by these fixtures.
