# Comparing single and dual reasoning

The harness has two suites. `diagnostic` preserves the original eight read-only
cases below. `coding` uses twelve dependency-free TypeScript repair projects,
with six calibration families and six distinct reserved families. These are
executable coding fixtures, not a benchmark of full application development.
The [local coding study from 2026-10-02](evaluations/reasoning-coding-2026-10-02.md)
records real-model calibration, interrupted attempts and the separately evaluated
reserved split. It does not establish a general coding accuracy gain.

## Coding campaigns

Create a private pair manifest using the exact selectable Router IDs and expected
upstream response IDs. The names below are placeholders, not configured models:

```json
{
  "pairs": [
    { "id": "coder-a", "model": "provider/model-a", "responseModel": "model-a", "evaluator": "typesafe/jev" },
    { "id": "coder-b", "model": "provider/model-b", "responseModel": "model-b", "evaluator": "typesafe/jev" }
  ]
}
```

Each pair may contain `pricing: { source, s2: { input, output, cacheRead,
cacheWrite }, s1?: { input, output } }`, with verified USD rates per million
tokens. Reported upstream charges take precedence. Estimating requires complete
token usage from every successful request; absent usage or prices remain unknown.
Catalog prices alone do not certify complete billing rates. `evaluatorResponseModel`
may additionally pin the S1 upstream response ID; every run records the selected
S1 model, its actual response IDs and its evaluation identities.

Preview the execution count, fixed splits and model selections without a key,
starting a service or calling a provider:

```sh
bun run eval:reasoning --suite coding --pairs /path/to/pairs.json \
  --split calibration --experiments baseline,verification --rounds 2 --dry-run
```

After selecting the models and authorizing an absolute USD budget, execute with
`--key-file`, `--output` and `--max-cost-usd`. Coding executions require that
explicit budget. Run calibration first, freeze the chosen configuration, then
evaluate it on `--split held-out`. Do not tune on reserved-case results and call
the same cases independent validation. A full two-pair, two-round campaign has
96 executions per experiment: 48 calibration and 48 reserved.

```sh
bun run eval:reasoning --suite coding --pairs /path/to/pairs.json \
  --split calibration --experiments baseline --rounds 2 \
  --key-file /path/to/private-key-file --max-cost-usd "$BUDGET_USD" \
  --output /tmp/redcode-coding-results --gate
```

`baseline` and `verification` explicitly select the existing verification
switch. `code-repair` enables review of candidate code snapshots and a scoped
repair for established S1 code issues. `self-review` adds a single-mode S2
self-review as a control against that same dual repair. Both use at most four
repair Steps with 2,048 output tokens per Step, existing permissions, previously
edited files and previously used foreground test commands. The final repair
Step has no tools. An uncertain S1 score alone never authorizes a code repair.
Curation, learning and tool selection stay disabled. Curation needs a
separate multi-prompt campaign: these fresh Sessions have no older exchanges to
curate, so enabling that flag here would repeat the baseline.
Evaluating namespace selection needs a separate Code Mode campaign that retains
nested-command completion evidence; enabling it with the current direct tool
interface would have no effect. `--modes single,dual,observe` collects
observation separately; observation never enters
the acceptance pairs. Acceptance is evaluated for every model pair, experiment
and split: more dual passes, no case regression or degraded repair, complete
known total cost at most 2x single, including every matched pair. An aggregate
gain cannot hide a failing group. Failed, invalid and timed-out executions remain
failures, and a partially executed campaign cannot pass.

Every coding execution gets a fresh Session and a byte-restored fixture. One
Location per case bounds Location accumulation. The agent can read the fixture,
edit only its declared source files and run `bun test` or `bun run test`. Tests
and package metadata are protected by permissions and checked for changes.
No dependencies need installation. The command must complete successfully in
the projected tool evidence; a claimed command or `bun test --help` does not
count. Temporary homes and permissions isolate normal configuration and Session
state; shell execution is not an operating-system sandbox.
Automatic worktree creation is disabled only in the isolated benchmark service:
its fixtures already have an owned placement, and the oracle must inspect the
same directory the agent edits. Snapshots remain enabled in those repositories.

The original independent oracle runs outside the agent directory after the
Session settles. It evaluates behavior, not response prose, with a ten-second
timeout and a bounded output parser. Passing also requires a real permitted
source edit and no changed protected files or extra files. The report must include
the case's exact check IDs and the oracle's completion receipt; candidate logs or
an early successful process exit cannot replace those checks. CI executes every
buggy seed and reference against the oracle and runs each visible test command
without paid inference. It validates the evaluator, not model accuracy.
The oracle verifies runtime behavior; it does not check compatibility of
TypeScript exports that exist only as types.

Artifacts record the compiled binary SHA-256, fixture signature, file-change
identities, oracle checks, exit code, latency, output byte counts, model identity,
tokens and costs. Oracle latency is separate from S2 completion latency.
Artifacts also retain the original execution outcome separately from validation
errors, the exact response-review evidence, and a funnel of reviews, suspected
code defects, repair admissions, candidate attempts, subsequent test calls and
fresh successful checks. Confirmed recovery comes from the before/after oracle
grades; a suspicion or successful command alone is not a confirmed correction.

Pair manifests may pin `variant` to an advertised reasoning variant. Both modes
use that same variant, and changed selections invalidate the run. Coding campaigns
use a recorded focused stop-loss profile in both modes: checkpoints every four
Steps, a two-Step cooldown, a three-Step idle signal, 12,000 new-work tokens and
two minutes without progress. This changes the harness policy from the original
2026-10-02 collection and must not be pooled with those historical results.
Coding fixtures use isolated Git repositories with metadata outside their
resettable directories. For automatic repairs, the harness resolves the first
repair's evaluation to its candidate message and reconstructs that Step's
existing end snapshot in a separate directory. The independent oracle grades
that exact candidate and the final code; neither reconstruction nor grading
changes the final fixture. Artifacts retain the candidate ID, snapshot ID,
initial oracle metrics and grade. Missing candidate snapshots are marked
`unknownBaseline`, excluded from repair improvement categories and fail the
repair gate. The buggy seed is never passed off as that candidate.

The absolute budget is checked between executions and passed to the Session's
existing budget controls. Provider accounting can arrive after an individual
call, so this is not a guaranteed invoice ceiling. Unknown completed-run costs
stop a budgeted campaign. Timeouts and background shell work stop the campaign
before reusing the fixture. Unsettled observations stop collection instead of
being reported as complete or attributed to the next execution. Remote caching
and its freshness remain Router responsibilities. `campaign-state.json` retains
request status, timing, bytes and collected results even if an execution fails
before grading; it does not invent a grade for interrupted work.

## Fixed-candidate S1 detector

Preview without credentials or inference:

```sh
bun run eval:reasoning:detector --split calibration --dry-run
```

The detector has 24 fixed candidates: a correct reference and a defective seed
for each of the existing twelve coding families. Before each dispatched S1
request, independent execution verifies its label. S1 receives the requested
contract and candidate source, using the production code-review rubric; labels
and hidden oracle checks never enter the request. This diagnoses the detector,
not end-to-end dual performance. These already inspected families do not constitute
a new untouched final validation set.

After a separate explicit budget authorization, use the connection's established
native endpoint and pin its actual response model:

```sh
bun run eval:reasoning:detector --split calibration \
  --router http://127.0.0.1:25050/v1 --endpoint decisions \
  --evaluator provider/decision-model --response-model actual-decision-model \
  --key-file /path/to/private-key-file --max-cost-usd "$DETECTOR_BUDGET_USD" \
  --output /tmp/redcode-detector.json
```

The runner makes no S2 calls and does not guess between native endpoints.
It records status, latency, response bytes, actual model, probabilities and
reported S1 charge per request. Any unknown charge stops collection and remains
unknown; budget checks occur between requests and cannot certify an invoice
ceiling. The report separates false alarms, missed defects and unavailable
responses. Threshold diagnostics are calibration-only and do not alter the
runtime's 0.75 repair threshold. The original US$5 collection remains closed.

## Read-only diagnostic suite

Run the same read-only tasks in fresh sessions with one fixed S2 model. Dual mode
adds the configured S1 classifier and response gate; single mode omits them.
The grading oracle uses deterministic fixture facts and does not use S1 verdicts.

```sh
bun run eval:reasoning \
  --binary /path/to/redcode \
  --router http://127.0.0.1:25050/v1 \
  --model openrouter/openai/gpt-4.1-mini \
  --response-model openai/gpt-4.1-mini \
  --evaluator openrouter/typesafe/jev-1.13 \
  --key-file /path/to/private-key-file \
  --rounds 2 \
  --output /tmp/redcode-reasoning-results
```

The key file must contain a previously authorized router credential. Keep it
private and remove it after use. The runner creates a temporary home and starts
an isolated service on an available port. It does not reconfigure the normal
service or use its sessions. Only fixture files receive read permission; all
other tools and external directories are denied. The temporary service and
credential storage are removed when the runner exits normally or throws.

The eight cases cover unknown API facts, untrusted ticket text, integer invoice
rounding, zero cursors, a correct tenant policy, unfinished CI, worktree
continuity and compaction credential identity. Two rounds produce 16 paired
comparisons, with pair order alternating to reduce order effects. This is a
small diagnostic sample, not evidence of production coding effectiveness.
Generation uses the installed runtime's defaults rather than forcing a sampling
temperature. Reruns can differ.

Each case keeps one read-only fixture Location across modes and rounds. Every
execution still gets a fresh Session. This bounds the number of loaded Locations
so their accumulation does not distort later latency measurements; the agent
cannot modify these shared fixture files.

For each run the output retains the initial and final grades, repairs,
completed reads, S1 evaluations, S1/S2 token counts and Session budget. A run is
invalid if required fixture reads fail, S1 runs in single mode, dual gates are
missing, projected budget accounting disagrees, or the selected/actual S2 model
changes. Invalid, failed and timed-out executions remain in the pass-rate
denominator. The report records planned and completed run counts; an aborted
suite must not be presented as complete.

A recording loopback proxy forwards router traffic and records HTTP status,
time to headers, time to the first response chunk, full-response latency, byte
count, stream completion and returned model IDs. It excludes router keepalive
sentinels and never records authorization headers or request bodies. API calls
to the isolated service also record status, full-response latency and bytes.
The recording proxy disables Bun's default ten-second idle timeout so quiet
streaming gaps do not truncate final usage or billing evidence. The campaign's
Session deadline still bounds each execution.
The output does retain model responses and fixture content, so it should still
be reviewed before sharing.

Token totals include S1 usage even when an evaluation is inconclusive or
unavailable. The proxy also retains upstream `usage.cost` when reported, including
zero. Streaming costs are cumulative, so only the final reported value counts.
Missing costs remain unknown rather than being treated as free.

Use `--pricing /path/to/pricing.json` when the router omits S2 charges. Rates are
USD per million tokens and must match the pinned model IDs:

```json
{
  "model": "openrouter/openai/gpt-4.1-mini",
  "evaluator": "openrouter/typesafe/jev-1.13",
  "source": "URL or billing source and verification date",
  "s2": { "input": 0.4, "output": 1.6, "cacheRead": 0.1, "cacheWrite": 0.4 }
}
```

An optional `s1: { "input": number, "output": number }` provides an estimate only
when S1 charges are unavailable. Reported upstream charges take precedence.
Estimates are distinct from a billing invoice, and missing prices fail acceptance.
`--gate` returns a failing exit code unless the complete, valid paired suite has
more dual passes, no case-level accuracy regression, no degraded repair, and
known total S1+S2 cost within 2x single both overall and for every matched pair.
This is a benchmark acceptance gate, not a runtime spending guarantee against
an unknowable counterfactual single execution.

Repairs are classified as improved, unnecessary, degraded or ineffective by
comparing the original and final independent grades. Here “unnecessary” only
means both answers satisfy these fixture checks. It does not establish that
all aspects of a rewrite were unnecessary. Absence of repair is also not proof
of correctness. Plain answers retain correctness and request-coverage checks;
inconclusive gates do not establish an issue. S1 selects an arithmetic,
code-behavior or evidence check before S2 answers; S2 performs that check.

Use these results to decide what to investigate next. A stronger follow-up
needs harder coding tasks, actual edits and execution, broader models, more
rounds and known billing prices before choosing dual mode as a universal default.

The [0.70.3 diagnostic results](evaluations/reasoning-0.70.3.md) retain the paired
grades, latency and usage from the first complete validated sample.
The [accuracy experiments from 2026-10-01](evaluations/reasoning-accuracy-2026-10-01.md)
retain both focused-verification candidates, complete paired grades, known cost
provenance and acceptance verdicts.
