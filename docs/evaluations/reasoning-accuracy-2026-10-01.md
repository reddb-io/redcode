# Dual reasoning accuracy experiments — 2026-10-01

The selected operator-by-operator verification candidate passed the diagnostic
gate: **39/40 dual answers versus 35/40 single answers**, no paired regression,
and **1.138x estimated total cost**. Median latency increased from 3.13s to 4.44s.
This is a small read-only sample with one model pair, not a statistically
established improvement or a production quality guarantee.

S2: `openrouter/openai/gpt-4.1-mini`. S1: `openrouter/typesafe/jev-1.13`.
Each experiment ran five rounds of all eight read-only cases, fresh Sessions,
alternating pair order, one immutable fixture Location per case, and an independent
deterministic oracle. The harness revision that bounds Locations is `14a7030793`.
The selected binary was built from `1eab5be401d7f3aa1baae74f6bbaf4ab4d2d66f7` in
[CI](https://github.com/reddb-io/redcode/actions/runs/36874598745), which passed
lint, type checking, Linux/Windows contracts, native builds and compiled smoke tests.
Its dry-run version is 0.70.5; this experiment does not publish a release.

## Selected candidate

S1 chooses a confident arithmetic, code-behavior or evidence check; S2 performs it.
The code check substitutes concrete inputs and evaluates operators in order,
resolving truthiness, coercion and short-circuit branches before later operations.
Observed behavior and intended behavior are derived separately before assigning
the requested output fields. No fixture answer is included in runtime guidance.

| Mode   | Passes | Median ms | P95 ms | S1 USD   | S2 USD   | Total USD |
| ------ | ------ | --------- | ------ | -------- | -------- | --------- |
| single | 35/40  | 3133      | 5068   | 0.000000 | 0.031031 | 0.031031  |
| dual   | 39/40  | 4437      | 5832   | 0.008856 | 0.026453 | 0.035309  |

Total cost was 1.138x single. The highest paired cost ratio was 1.758x.
Every matched pair stayed within 2x. No case or individual pair regressed, no
evaluation was unavailable, and no repair was triggered. All model IDs, fixture
reads and projected usage passed the validity checks.

| Case                 | Single passes | Dual passes |
| -------------------- | ------------- | ----------- |
| unknown-api          | 5/5           | 5/5         |
| untrusted-data       | 5/5           | 5/5         |
| rounding-review      | 5/5           | 5/5         |
| zero-cursor          | 0/5           | 4/5         |
| correct-tenant-check | 5/5           | 5/5         |
| unfinished-ci        | 5/5           | 5/5         |
| worktree-continuity  | 5/5           | 5/5         |
| compaction-identity  | 5/5           | 5/5         |

The zero-cursor answer still failed once in dual mode; S1 did not detect or repair
that error. The proactive check improved observed accuracy, while response
correctness review remains an unreliable verifier for these numerical results.
Harder edit-and-execute tasks, more model pairs and larger independent samples
remain necessary before recommending dual as a universal default.

## First candidate and excluded execution

The first focused-verification candidate, built from `1e31e092e0` in
[CI](https://github.com/reddb-io/redcode/actions/runs/36870596447), completed all
80 executions and passed with 36/40 dual versus 35/40 single, 1.171x total cost,
and no regressions. Its zero-cursor result passed only 1/5 dual runs. The selected
candidate makes that code check more concrete; both complete experiments remain
in the machine-readable evidence. Cross-run sampling prevents attributing all
differences to the prompt change.

An earlier five-round execution was interrupted when the local router service
stopped, returning HTTP 502 during round five. Its 68 recorded runs were retained
outside the repository and excluded entirely from acceptance.

## Cost and evidence

S1 charges come from the router’s reported `usage.cost`. S2 charges are estimates
from OpenRouter model rates verified on 2026-10-01, including cache-read rates.
These combined numbers are not an invoice. The 2x criterion is a benchmark gate,
not a runtime guarantee against a counterfactual single execution. Missing prices
or incomplete/invalid execution fail acceptance.

[Machine-readable evidence](reasoning-accuracy-2026-10-01.json) includes every
paired grade and known cost, source SHA, binary checksum, pricing provenance
and the acceptance verdict for both complete experiments. Reproduction and
metric definitions are in [reasoning evaluation](../reasoning-evaluation.md).
