# Comparing single and dual reasoning

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
