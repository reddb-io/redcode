# Published 0.71.3 local dual reasoning evaluation — 2026-10-02

The published asynchronous-classifier release has **not demonstrated a coding
accuracy or speed gain** in this collection. Baseline calibration completed with
6/6 valid passes in both modes, 29.5% higher dual cost and 59.6% more aggregate
execution time. All six baseline matched costs stayed below 2×. Scoped-repair
calibration also tied on accuracy but cost 2.277× in aggregate. The self-review
comparison contains one invalid dual run with an interrupted, unpriced provider
response. No configuration qualified for promotion; reserved cases were not
dispatched after that unknown charge.

The [machine-readable evidence](reasoning-0.71.3-2026-10-02.json) preserves the
pilot, baseline and experimental executions separately, including independent
oracle checks, pre-review candidate snapshots, validation failures, model
identities, tokens, known and unknown costs, and S1 telemetry. The
[complete HTTP receipts](reasoning-0.71.3-2026-10-02-http.json.gz) are
gzip-compressed JSON: request status, latency, bytes, stream completion and model
identity are retained for every local API/proxied Router request. Credentials and
raw model prose are excluded. The archive SHA-256 is recorded in the evidence.

## Baseline calibration

One model pair, three challenge calibration families, two repetitions and both
modes give twelve executions. Each uses a fresh Session and restored fixture,
requires a real source edit and successful foreground test, and receives an
independent behavioral grade. All reasoning experiment switches remain off.

| Mode | Valid passes | Conventional median execution latency | Total S1+S2 USD |
| --- | --- | --- | --- |
| Single | 6/6 | 65.53s | 0.043593400 |
| Dual | 6/6 | 119.12s | 0.056464207 |

Conventional medians average the two middle observations for six executions:
81.8% higher dual latency. The harness's nearest-rank medians are separately
retained in JSON: **54.15s single and 78.18s dual** (44.4% higher). Do not mix
these quantile definitions. Aggregate execution time was 461.86s single versus
737.04s dual. Dual was faster in one of six pairs; this is a small descriptive
sample, not a statistically established population effect.

| Family | Round | Single latency | Dual latency | Dual/single total cost |
| --- | --- | --- | --- | --- |
| Singleflight settlement | 1 | 133.54s | 160.06s | 1.211× |
| Composite page cursor | 1 | 44.36s | 78.18s | 1.736× |
| Three-way document merge | 1 | 116.35s | 167.46s | 1.147× |
| Singleflight settlement | 2 | 76.90s | 253.20s | 1.844× |
| Composite page cursor | 2 | 36.55s | 23.32s | 0.806× |
| Three-way document merge | 2 | 54.15s | 54.83s | 0.748× |

The aggregate cost ratio was **1.295×**. These six observed pairs satisfy the
monetary criterion, but a perfect single baseline provides no accuracy headroom.
The acceptance gate failed with `no_accuracy_improvement`; it did not promote
the dual configuration. No automatic repairs ran in this baseline.

S1 classification latency ranged from 763 to 936 ms, median 902 ms. All six dual
classifications recorded `frustration` and `user_feedback`; single made no S1
calls. Post-completion advisory collection had a conventional median of 16.6 ms
and maximum 152.3 ms. That collection time is separate from execution latency;
late S1 tokens and costs still belong to their execution. This verifies signal
collection, not a quality gain caused by satisfaction prompts or the live mood UI.

## Fixed-candidate detector

The unchanged `code-behavior-v1` rubric and existing 0.75 threshold separated
**all three defective seeds from all three correct references**: three true
positives, three true negatives, no false alarms or missed defects. Independent
execution verified every label before S1 dispatch; hidden oracle checks and
labels did not enter the questions. All six `/v1/decisions` responses were HTTP
200, 274–275 bytes, with 606–726 ms full-response latency. Reported cost was
**US$0.000262752**.

Lower thresholds produced false alarms and 0.9 missed one defect; runtime policy
was not changed. This is detector calibration on only six fixed candidates. It
is neither reserved validation nor evidence that S1 improves real agent work.
No reserved detector cases were inspected or dispatched.

## Scoped-repair and self-review comparisons

One complete round of each experiment was planned before dispatch: three
families × two modes × two experiments = twelve executions. This bounded first
round replaces the optional two-round draft; the model, rubric, threshold,
permissions and execution profile remain unchanged.

`code-repair` compares ordinary single with opt-in S1 review of candidate source.
The three matched pairs have complete usage and valid outcomes:

| Mode | Valid passes | Conventional median execution latency | Total S1+S2 USD |
| --- | --- | --- | --- |
| Single | 3/3 | 52.03s | 0.018282447 |
| Dual | 3/3 | 75.72s | 0.041621941 |

No S1-triggered repair was admitted. Dual cost **2.277×** single overall;
`singleflight-settlement` and `three-way-document-merge` also exceeded 2×
individually. This candidate failed accuracy-improvement and cost gates.
The measurements do not isolate the switch's causal effect from generation and
provider variability.

`self-review` compares equally bounded additional S2 self-review in single
against the same S1-guided repair policy in dual:

| Mode | Valid passes | Conventional median execution latency | Total S1+S2 USD |
| --- | --- | --- | --- |
| Single | 3/3 | 71.81s | 0.029031238 |
| Dual | 2/3 | 41.43s | Unknown |

All three forced S2 reviews had independently correct pre-review candidates.
They each ran one capped review Step without a subsequent test or source edit;
the final code remained correct. Each recorded a `responseReview` notice with
status `unavailable` and no replacement answer. Their output cap and unavailable
results limit this comparator; it cannot certify a successful review capability.
There were no measured recovered defects, degraded code repairs or S1-triggered
repair admissions. Previous tests stayed valid because the source was unchanged.

The final dual merge execution recovered after `ECONNRESET` and produced code
that passed the independent oracle. One HTTP 200 response nevertheless remained
incomplete after **348,911 bytes**, without final token usage. The recovered
execution took 198.63s. The harness records `executionOutcome: succeeded` but
`outcome: invalid`, with `incomplete_provider_response`, and keeps its full S2
charge unknown. It counts as a failure in the valid-pass denominator; this is
an accounting/transport failure, not demonstrated incorrect merge behavior.
The full self-review cost ratio is unknown and no speed or accuracy win is claimed.

## Budget and collection stop

The user authorized **a new US$5 allocation**, separate from the closed previous
study. This collection dispatched 26 Sessions (two pilot, twelve baseline,
twelve experimental) plus six detector requests. The pilot's valid pair is kept
separate from calibration and cost US$0.010901773.

Known reported/estimated cost is a **lower bound of US$0.214906294**. This includes
US$0.005441416 of complete successful S2 requests in the final invalid execution,
calculated from projected token usage and verified rates and matched against
Router ledger receipts. The interrupted request has no final usage or identified
complete ledger receipt and remains unpriced. It is never assigned zero charge.

The experimental campaign's full US$1.50 reservation is retained. Conservative
commitments total **US$1.611222133**; **US$3.388777867** is uncommitted.
Reservations are not charges. No further paid inference or reserved campaign
was dispatched after the unknown charge. The temporary key file was removed;
the installed normal service and Router configuration were not changed.

## Provenance and limits

- Published version: **0.71.3**, commit `11bd5767e393b7e53f2327316390017ea70ebce6`,
  [release](https://github.com/reddb-io/redcode/releases/tag/v0.71.3).
- Published native binary SHA-256:
  `2917077a6be77d36bc4b96b8c7386683cc8edd10c6da0e099d1542126a1dfd33`.
- Harness source is the same release commit; no runtime code changed during collection.
- Host: the user's Linux PC, Intel Core i7-1065G7, eight logical CPUs.
  Inference used the local Router's OpenRouter connection. Shared desktop and
  provider conditions were not controlled; pair order alternates.
- S2: `openrouter/xiaomi/mimo-v2.6-pro`; actual response `xiaomi/mimo-v2.6-pro`.
- S1: `openrouter/typesafe/jev-1.13`; actual response `typesafe/jev-1.13-20260917`.
- Router: `http://127.0.0.1:25050/v1`. Caching remains entirely Router-owned.
- Baseline challenge fixture signature:
  `bc0c99b1e2a90f40eee230281773980355fb7aef7563fae9a34d42e9e6590e5f`.
- Detector challenge signature:
  `0c9fd4ed67b7cf4a5304d6d5789d77c6beb8dccc121c6b011664cb9523df813e`.
- S2 estimated USD/million tokens: input 0.435, output 0.87, cache read 0.0036,
  cache write 0.435, checked against OpenRouter and the authenticated Router
  catalog on 2026-10-02. Complete response/projected usage is required. S1 uses
  upstream-reported charges. Estimates are not an invoice; the dynamic S2's
  native Session USD projection cannot certify an absolute spending ceiling.
- Coding policy: 24 logical Steps, checkpoint every four, two-Step cooldown,
  three-Step idle signal, 12,000 new-work tokens and two minutes without progress;
  300-second execution deadline. Repair allows at most four Steps of 2,048 output
  tokens each and existing scoped permissions. The final repair Step has no tools.

The [earlier coding study](reasoning-coding-2026-10-02.md) used a different,
unpublished dry-run binary, corpus and execution policy. It cannot be pooled
with this collection or establish a before/after effect of the new architecture.
The earlier read-only 35/40 versus 39/40 result is also a separate study.
Accuracy here covers independent runtime behavior and required edits/tests,
not all final-response prose, type-only exports or production application work.
A perfect baseline and no observed defective candidate cannot measure recovery.

Next work is to reconcile interrupted-request billing, measure recovery from
explicitly labeled defective candidates with a successful bounded S2 control,
and test narrower guidance that reduces extra S2 work while retaining user
feedback telemetry. No model, threshold or experiment is promoted by this study.
Reserved challenge families remain unused and must not become tuning inputs.
