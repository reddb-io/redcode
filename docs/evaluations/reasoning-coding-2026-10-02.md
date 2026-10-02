# Local coding evaluation — 2026-10-02

This study has not demonstrated a coding accuracy gain from dual reasoning.
The baseline calibration completed with 12/12 passes in each mode, higher dual
median latency and two matched costs above the 2× ceiling. The experimental
verification calibration stopped after an execution timeout and is incomplete.
The frozen baseline's reserved evaluation stopped at 11/24 executions on
another timeout, with one more matched cost above 2×. Paid collection is closed.
No configuration has been promoted, and the per-case cost ceiling is not validated.

## Calibration results

| Experiment | Mode | Passes | Median latency | P95 latency | S2 USD | S1 USD | Total USD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | Single | 12/12 | 49.52s | 228.03s | 0.057140 | 0 | 0.057140 |
| Baseline | Dual | 12/12 | 81.66s | 202.44s | 0.071829 | 0.004892 | 0.076720 |

Baseline dual cost was **1.343×** single (+34.3%); its median latency was
**64.9% higher**. Both modes passed all behavioral checks, with actual source
edits and completed test commands. There were no automatic repairs or evaluator
failures. Medians and P95 use the harness's nearest-rank empirical quantiles.

The monetary gate failed on `async-map-order`, round 2 (**2.726×**), and
`unicode-codepoint-limit`, round 2 (**2.189×**). An acceptable aggregate ratio
does not override either violation. The accuracy gate also failed because dual
did not improve the pass count.

Verification collected **10/24 executions**: single passed 5/5, dual 4/5.
The dual `retry-attempt-limit` execution hit the **300-second** deadline after
reading three files, without an edit or successful test command. One S2 response
stream remained incomplete after **1,468,036 bytes**, so its complete charge is
unknown. The case remains a failure in the collected denominator, and the
unexecuted cases remain unexecuted. These results cannot establish a complete
verification cost ratio or a general regression caused by the switch. No
post-output verification Step was admitted in these collected executions.

## Reserved results

The configuration was frozen before execution: **baseline**, with all four
experimental switches off and `promoted: false`. Neither calibration candidate
qualified, so the predeclared fallback was evaluated for diagnosis. Reserved
results did not change that choice.

Collection stopped at **11/24 executions**: single passed **5/5**, dual **5/6**.
The five completed matched pairs passed in both modes. The sixth dual run has
no executed single counterpart, so its failure is not a measured paired
accuracy regression. `literal-secret-redaction`, round 1, cost **2.362×** single.

The dual `query-filter-encoding` run hit the deadline at **300.28 seconds**.
It read three files and completed one visible `bun run test` command with exit
zero, but made **no source edit**. The independent oracle rejected the unchanged
behavior. Attempts to explore outside the declared fixture permissions were
denied; no edit was proposed. A final S2 stream remained incomplete after
**312,665 bytes**, leaving the full charge unknown. The Router stayed running
through both final timeouts. No post-output verification Step ran in either
timeout; these observations do not establish that verification caused them.

For the five complete matched pairs only, estimated single cost was **US$0.029945**
and dual cost **US$0.029337**, with nearest-rank medians **123.58s** and **80.43s**.
This exploratory subset excludes the unmatched timeout and its unknown charge.
It cannot establish an overall speedup or cost reduction. The reserved campaign
remains incomplete, and its full cost ratio is unknown.

## Configuration and evidence

All paid benchmark executions ran on the user's Linux PC, with an Intel Core
i7-1065G7, eight logical CPUs and 16.3 GB RAM. Model inference used the local
Router's OpenRouter connection. Windows CI checked compatibility only.
Each execution used a fresh Session and restored fixture. Six calibration
families have two repetitions per mode. The reserved split has six distinct
families and was fixed before tuning. Single/dual order alternates; experiments
run sequentially, so provider load and cache warming may affect comparisons.

The [machine-readable evidence](reasoning-coding-2026-10-02.json) preserves all
four calibration/reserved attempts separately, including failed executions,
oracle process receipts, source edits, completed and denied tools, model IDs,
token usage, cost completeness, and request status codes, latency and byte counts.
It excludes credentials and raw model prose. Request-latency summaries in that
artifact use conventional medians; execution summaries use the harness's
nearest-rank quantiles reported above. Fixture SHA-256 signatures are:

- Calibration: `55c6544f04769d77a1921995d46cf9c59fe20f0ead07930cab0d387d479b796e`.
- Reserved: `6d2169a9d64bcc605875cd68797e772ed2fa130f156be1dfafe6e4a85e69b4ae`.

Only one S2 was available for this campaign:

- S2 selection: `openrouter/xiaomi/mimo-v2.6-pro`; response: `xiaomi/mimo-v2.6-pro`.
- S1 selection: `openrouter/typesafe/jev-1.13`; response: `typesafe/jev-1.13-20260917`.
- Router: `http://127.0.0.1:25050/v1`. Caching remains the Router's responsibility.
- Baseline disables all four reasoning experiments; verification enables only
  `reasoning_verification`. Tool selection, context curation and learning stay off.

The compiled binary reports **0.71.3**, from an **unpublished CI dry run** at
`4d5e9ac93abcf40297f5655c0d9067ff887a5558`:
[binary build](https://github.com/reddb-io/redcode/actions/runs/37001921440).
Its SHA-256 is
`56f7b6497ddb33e60385b2183d1de279c725e90cf5cd906f22678ef27788534e`.
The final collection harness is `c334e14ad003557efe2608626b5c1cb4c9c4e904`,
with [terminal successful CI](https://github.com/reddb-io/redcode/actions/runs/37011229882).
The binary was not built from this later harness commit.

S2 costs are estimates from complete token usage and verified USD rates per
million tokens: input **0.435**, output **0.87**, cache read **0.0036**, cache
write **0.435**. Rates were checked against OpenRouter and the Router catalog
on 2026-10-02. Cache writes use ordinary input pricing; none were observed in
any exported attempt. S1 uses reported upstream charges. Estimates are
not an invoice. The native Session USD projection stayed zero for this dynamic
S2, so the harness uses independent usage-based accounting rather than treating
it as free. Native absolute budgets do not establish the counterfactual 2× ratio.

## Interrupted setup and collection

The first pilot was invalid: automatic worktree admission blocked edits and
tests. The isolated benchmark now disables automatic worktrees while retaining
snapshots. A second pilot produced a valid matched pair; it is not part of the
calibration or held-out accuracy sample.

The first calibration stopped at 12/48 after three externally observed Router
service restarts interrupted streams. The next stopped at 3/48 because the
recording proxy's default ten-second idle timeout truncated a quiet stream.
That proxy timeout was removed, and CI verifies an eleven-second streaming gap
with final usage and billing evidence. The corrected campaign then stopped at
34/48 on the genuine execution deadline described above. These interrupted
campaigns are preserved separately and cannot be pooled into a complete campaign.

Authorization is **US$5 across all attempts**. Known reported/estimated costs
total **US$0.304772**, a lower bound with incomplete billing. Conservative budget
commitments total **US$4.956817**, leaving **US$0.043183** uncommitted. Commitments
are reservations, not charges: interrupted attempts retain their full limits
until unknown charges are reconciled. No missing response is assigned zero cost.
No further paid attempts are running or planned within this allocation.

These are small, dependency-free, single-file repair projects. Accuracy means
independent runtime behavior plus required edits and test execution; it does
not grade all response prose, type-only exports or production application work.
A 100% baseline leaves no room to demonstrate an accuracy gain on these cases.
The earlier read-only 35/40 versus 39/40 result remains a separate study.

## Next work

1. Reconcile interrupted-request charges. The Router should expose reported,
   estimated or unknown usage by request ID; caching remains entirely there.
   Redcode also needs correct native cost accounting for dynamic catalog models.
2. Bound S2 reasoning/output and recover from repeated denied exploration using
   existing Session execution machinery. Successful commands alone must not
   substitute for the requested behavior or an independent oracle.
3. Calibrate S1 against both correct and incorrect candidates, then evaluate
   harder, independently reserved coding cases. This sample's perfect single
   baseline cannot measure an accuracy gain. New paid collection needs its own
   allocation; these failed and incomplete attempts remain part of the record.
