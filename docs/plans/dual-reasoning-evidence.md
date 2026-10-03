# Redcode dual reasoning: evidence and controlled experiments

The router owns all inference/response caching. Redcode retains durable evaluations, source fingerprints, manifests and learning proposals for audit; it does not reuse an inference response as a local cache.

## Runtime

- `single`: S2 only.
- `dual`: S1 classifies and reviews through the existing semantic gates.
- `observe`: S2 uses the single path. S1 runs asynchronously and records recommendations, latency, tokens, reported USD charges and unknown charges. Observation records cannot guide routing, skills, tools, response repair, completion gates or context selection. Service shutdown can interrupt unfinished observations; they are advisory work, not durable Session execution claims.

Configure globally with `/dual` (`/setup` remains an alias), `REDCODE_REASONING=observe` or `--standalone --reasoning observe`. `/reasoning` sets a durable per-session override; choosing the service default removes it. Overrides follow the Session's existing metadata inheritance and movement rules.

Classification includes goal, plan, tasks, pending input, original recent requests, previous decision and location, even for short continuation messages. Response reviews read projected tool facts beyond compaction. Status, IDs, exit codes, paths, errors, clipping and edit invalidations remain separate from bounded evidence text. Truncated evidence is visibly incomplete and retrievable by durable message/tool IDs.

## Independent experiments

All reasoning switches default to off and are listed in `/experiments`:

- `experimental.reasoning_code_repair`: review immutable candidate code diffs with dedicated behavior/contract questions. An established code issue may admit one repair with at most four candidate Steps, each capped at 2,048 output tokens. Only files successfully changed for this request and previously used foreground test commands are available, intersected with existing permissions. The final Step has no tools; new input supersedes the repair and projected history preserves the remaining allowance after restart. Missing snapshots or an absent repair scope cannot establish this path. A fresh successful allowed test is necessary for a revised code-review success note; S1 acceptance still does not replace an independent behavioral oracle.
- `experimental.reasoning_self_review`: evaluation control for single reasoning. S2 independently reviews its candidate once, using the same file, command, Step and output limits as code repair. It makes no S1 requests. This separates the value of S1 from an extra S2 opportunity; equal repair allowances do not guarantee equal billed cost.

- `experimental.reasoning_verification`: a confident S1 issue can admit one durable S2 verification Step with at most 2,048 output tokens. Only `read`, `glob`, `grep` and `session_history` can execute; permissions still apply. The original request, evidence and hypothesis accompany it. A tool-only inspection does not earn another synthesis Step. New input supersedes the verification. Normal pre-output retries, interruption, step/goal accounting and budgets remain owned by the Session runner.
- `experimental.reasoning_tool_selection`: add a namespace question to the existing bundled classification and rank the existing partial Code Mode listings. Every namespace and full search remain available. No MCP proxy or tool execution authorization is added.
- `experimental.reasoning_context_curation`: S1 may omit whole, closed, old read-only assistant blocks at a 0.95 threshold. It keeps the latest two exchanges, all user/system/synthetic/compaction messages, edits, checks, failed and unsettled tools. Native compaction windows are excluded. The model-facing copy changes; projected history does not. A manifest records each omitted message ID, source hash and evaluation ID.
- `experimental.reasoning_learning`: an accepted repair with fresh successful verification may produce a proposal linking both evaluation artifacts. It remains `proposed` until explicitly reviewed. Approval means ready for review/export; nothing installs a memory or skill automatically.

`/intelligence` exposes exact evaluation evidence, latency, tokens and price completeness, curation manifests and learning proposals. The authenticated experimental API supports session mode, evidence inspection, artifact listing and candidate review. Generated clients follow the public Protocol.

## Validation and limits

CI keeps the eight existing reasoning regressions and adds twelve edit/evidence fixtures plus eight continuation fixtures. The twenty new fixtures are split before tuning into ten calibration and ten held-out cases, with no shared family. They test real evidence/context/control implementations without model calls. These offline fixtures prove harness contracts, not improved model accuracy.

A future credentialed campaign can use `eval:reasoning --modes single,dual,observe`. It reports S2 completion latency separately from observation collection time. Observation is excluded from the single/dual acceptance pairs. Do not run paid inference without explicit authorization.

The [executable coding campaign](../reasoning-evaluation.md) adds twelve dependency-free repair projects: six calibration cases and six held-out cases from distinct families. Each execution starts with a fresh Session and restored source, requires an actual permitted edit and successful test command, then runs an independent behavioral oracle outside the agent directory. Model pairs, experiment switches, binary and fixture identities, file changes, process evidence and price completeness are recorded. Dry-run planning needs no key or model calls; execution requires an absolute USD budget. The [local coding study from 2026-10-02](../evaluations/reasoning-coding-2026-10-02.md) keeps calibration, reserved results and interrupted attempts separate; it does not establish a general coding accuracy gain.

This harness compares `baseline`, `verification`, `code-repair` and `self-review`. `code-repair` pairs single without extra review against scoped S1-assisted repair; `self-review` pairs single with its own bounded review against the same dual repair. Curation needs multi-prompt history, and namespace selection needs Code Mode with nested-command completion evidence; both remain separate evaluation work. Learning stays disabled. An automatic coding repair without a captured pre-repair filesystem state has an unknown baseline and cannot qualify as measured repair improvement. Calibration is for selecting a configuration; reserved families are for evaluating that frozen choice.

The fixed-candidate detector campaign uses the same code questions on correct and defective implementations, validated by independent execution before dispatch. It measures precision, recall, false alarms and unavailable responses separately from recovery. Threshold diagnostics are reported only for calibration and never change runtime policy. Its existing families are regression/calibration material; after the 2026-10-02 coding study they cannot substitute for a new untouched final validation set.

Implementation does not certify a gain. The [published 0.71.3 collection](../evaluations/reasoning-0.71.3-2026-10-02.md), authorized under a new US$5 allocation, completed baseline and detector calibration and dispatched the scoped-repair/self-review comparisons. Baseline tied on accuracy and was slower; scoped repair exceeded 2× cost. An interrupted unpriced response invalidated one self-review dual execution and stopped paid collection before reserved cases. Next work is billing reconciliation and measured recovery from known defective candidates with a working S2 review control. The previous US$5 collection remains separate and closed. Cache remains Router-owned.

The offline preparation now includes `--corpus challenge`: six new families fixed before model tuning, with three calibration projects (singleflight settlement, composite cursors, three-way merges) and three reserved projects (bounded FIFO admission, quoted CSV, route precedence). The original corpus remains the default. Both coding and detector runners record corpus identities and signatures; report grouping refuses cross-corpus comparisons. CI executes broken seeds, correct references and visible tests without inference. These are new evaluation inputs, not evidence of harder model outcomes or improved accuracy. Calibrate the detector and recovery on the calibration split, freeze the configuration, then evaluate reserved cases without tuning on their results. Reserved detector inspection must not become tuning input for a recovery validation on those same families.

Promotion requires more dual passes, no case regression or degraded repair, complete known S1+S2 charges at or below 2× single both in aggregate and per matched pair, and reported latency. Unknown prices fail the monetary gate. Runtime uses absolute Session budgets; an unknowable production single-mode counterfactual is not presented as a guaranteed 2× ceiling. The narrow earlier 35/40 versus 39/40 result is not evidence of general coding accuracy.

## Next experiment: recovery from the same candidate

Preparation only, as of 2026-10-03: no new provider requests, paid collection or
runtime policy change. The dedicated `eval:reasoning:recovery` runner now implements
the fixed-candidate comparison below, with an offline dry-run and CI regression
fixtures. It has not collected a credentialed campaign. Detector accuracy and
recovery accuracy remain different measurements.

The current detector supplies complete candidate source through the artifact
builder. Runtime review instead supplies snapshot diffs with ten context lines,
at most four files and 3,500 characters per file. Its repair prompt identifies
`code_behavior` or `code_contract`, leaving S2 to find the concrete violated
requirement. These differences are hypotheses to test, not established causes of
the measured overhead. A new candidate must not be promoted by changing the
confidence threshold until a favorable result appears.

1. **Close accounting first.** Reconcile the incomplete response in the published
   collection by provider/request identity. Keep its charge unknown if no receipt
   establishes it. The previous studies remain closed and retain their original
   outcomes; a new collection needs an explicit allocation and frozen manifest.
2. **Add a fixed-candidate recovery runner.** Reuse the six challenge calibration
   candidates already used by the detector: three defective seeds and three
   correct references. Restore byte-identical source in fresh Sessions for every
   arm and verify labels independently before dispatch. These are inspected
   calibration inputs, not new reserved evidence or agent-generated failures.
   Do not inject a fabricated edit, test result, assistant message or S1 verdict
   into production history merely to open its existing repair gate.
3. **Compare three arms on identical input.** Use S2-only review, S1 review with
   the current two generic code questions, and an experimental S1 review that
   scores separately identified requirements from the public request. Derive
   requirement text without labels, reference solutions or hidden checks. Feed
   only established requirement IDs and their original text to S2; S1 does not
   generate a correction. The two S1 arms initially receive the same bounded
   complete-source artifact to isolate guidance specificity. Any later diff
   comparison is a separate experiment with its own manifest.
4. **Bound and grade the recovery.** All arms receive the same permissions,
   at most four S2 Steps of 2,048 output tokens, a tool-free final Step and a
   300-second execution deadline. Defective candidates require an allowed edit,
   a fresh successful visible test and independent final behavior checks.
   Correct candidates can pass unchanged: the coding suite's unconditional
   `no_edit` rejection must not be reused for preservation controls. Record
   correct-to-incorrect degradation and unnecessary changes separately. Never
   expose independent oracle failures to the agent as guidance.
5. **Run a small calibration before expanding.** Six candidates across three
   arms give eighteen executions for one fixed model pair and one round. A
   no-repair S1 decision still counts in recovery accuracy; it cannot silently
   drop a defective candidate from the denominator. Retain classifications,
   admission, edits, fresh tests, before/after hashes, independent grades,
   complete S1+S2 charges and HTTP receipts. Report successful preservation,
   recovered defects, missed defects, false alarms, invalid runs and latency
   separately. The comparison includes the S1 calls that select whether to
   invoke S2, rather than reporting only admitted repair costs.

Freeze model identities, requirement rubric, threshold, artifact format, limits
and scoring before dispatch. Qualifying recovery must beat S2-only review on
defective candidates, preserve correct candidates, and satisfy the existing
known-cost 2× gates against each matched S2-only run and in aggregate. Only then
freeze a choice and evaluate unused reserved families without tuning on them.
A recovery result on seeded defects does not itself establish a general coding
or speed improvement; repeat an end-to-end coding comparison before enabling
the candidate by default.

The live accumulated-friction telemetry remains intact. Keep its prompt content
identical across matched recovery arms when supplied, using the same pre-existing
session evidence, and account for any telemetry collection calls separately.
Do not add sentiment analysis or extra calls to create the thermometer. Inference
and response caching remain entirely Router-owned.
