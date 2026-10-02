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

Implementation does not certify a gain. The next paid phase is detector calibration, followed by independently graded recovery and harder new reserved coding families. The previous US$5 collection is closed; no additional inference is implied by these changes. Cache remains Router-owned.

Promotion requires more dual passes, no case regression or degraded repair, complete known S1+S2 charges at or below 2× single both in aggregate and per matched pair, and reported latency. Unknown prices fail the monetary gate. Runtime uses absolute Session budgets; an unknowable production single-mode counterfactual is not presented as a guaranteed 2× ceiling. The narrow earlier 35/40 versus 39/40 result is not evidence of general coding accuracy.
