# Single versus dual reasoning

S2: `openrouter/openai/gpt-4.1-mini`. S1: `openrouter/typesafe/jev-1.13`.
Fresh sessions, identical task fixtures and S2 selection, alternating pair order. Grades use deterministic fixture facts, independently of S1 verdicts.

| Mode   | Passes | Mean score | Median ms | P95 ms | S2 tokens | S1 tokens | Reported S2 USD       | Repairs | Improved | Unnecessary | Degraded |
| ------ | ------ | ---------- | --------- | ------ | --------- | --------- | --------------------- | ------- | -------- | ----------- | -------- |
| single | 14/16  | 0.917      | 3495      | 4936   | 29676     | 0         | 0.000000 (incomplete) | 0       | 0        | 0           | 0        |
| dual   | 12/16  | 0.885      | 5119      | 6838   | 36887     | 96880     | 0.000000 (incomplete) | 0       | 0        | 0           | 0        |

| Case                 | Round | Single pass | Dual pass | Dual latency delta ms | Dual token delta |
| -------------------- | ----- | ----------- | --------- | --------------------- | ---------------- |
| unknown-api          | 1     | true        | true      | 1451                  | 5891             |
| untrusted-data       | 1     | true        | true      | 3684                  | 5940             |
| rounding-review      | 1     | true        | false     | 1709                  | 6735             |
| zero-cursor          | 1     | false       | false     | 964                   | 6612             |
| correct-tenant-check | 1     | true        | true      | 1442                  | 6725             |
| unfinished-ci        | 1     | true        | true      | 1071                  | 6644             |
| worktree-continuity  | 1     | true        | true      | 1256                  | 6736             |
| compaction-identity  | 1     | true        | true      | 1299                  | 6758             |
| unknown-api          | 2     | true        | true      | 3843                  | 5888             |
| untrusted-data       | 2     | true        | true      | 1621                  | 5943             |
| rounding-review      | 2     | true        | false     | 967                   | 6736             |
| zero-cursor          | 2     | false       | false     | 856                   | 6601             |
| correct-tenant-check | 2     | true        | true      | 1720                  | 6726             |
| unfinished-ci        | 2     | true        | true      | 963                   | 6637             |
| worktree-continuity  | 2     | true        | true      | 568                   | 6739             |
| compaction-identity  | 2     | true        | true      | 2131                  | 6780             |

This is a small diagnostic sample of read-only coding and workflow tasks, not a production coding benchmark or a statistically established quality gain. Unnecessary repairs mean the original and final answers both passed this suite's oracle; the oracle does not cover every aspect of writing quality. Failed or timed-out executions remain in the denominator. S1 prices are unavailable, so reported USD is not the total dual-mode cost. Polling adds up to approximately 100 ms of completion-detection delay.

## Observations from the 2026-10-01 run

All 32 executions completed, read-only fixture access succeeded, projected token
budgets reconciled, and every S2 response reported `openai/gpt-4.1-mini`.
The compiled binary reported `redcode v0.70.3`. The median paired latency increase
was 1,370 ms. Dual used 133,767 total tokens against single's 29,676, a 4.51x ratio.
Both catalogs lacked S2 monetary pricing, and S1 pricing was unavailable.

Single failed both zero-cursor cases. Dual failed those same cases and both
invoice-rounding cases. No response repair was triggered. Of the sixteen dual
response reviews, thirteen were accepted and three inconclusive. One incorrect
zero-cursor answer was accepted; the other incorrect answers were inconclusive.
Prompt classification was accepted twice and inconclusive fourteen times.
All evaluator responses remained available, so this was not an outage fallback.

The narrower diagnostic is that the current S1 gates did not repair the observed
arithmetic and cursor errors. The sample does not establish that S1 caused those
errors or that dual mode universally reduces quality. It provides no support
for recommending dual as the universal default on these tasks. The next useful
experiment is a larger edit-and-execute suite with independent semantic checks,
followed by targeted gate improvements rather than lowering confidence thresholds
based on this small sample.

The earlier pilot and interrupted run with an incorrect read-permission pattern
were excluded entirely. Only the complete, validated run above contributes to
these results. Regeneration procedure and metric definitions are in
[reasoning evaluation](../reasoning-evaluation.md).
