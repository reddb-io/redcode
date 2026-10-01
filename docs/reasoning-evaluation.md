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
unavailable. Reported monetary cost comes from the runtime's S2 catalog pricing.
Missing S2 prices and all S1 prices remain unknown; a reported zero does not
establish that a run was free. No total dual-mode price is claimed.

Repairs are classified as improved, unnecessary, degraded or ineffective by
comparing the original and final independent grades. Here “unnecessary” only
means both answers satisfy these fixture checks. It does not establish that
all aspects of a rewrite were unnecessary. Absence of repair is also not proof
of correctness: tool-free answer classification narrows response review to
refusal checks, and inconclusive gates do not establish an issue.

Use these results to decide what to investigate next. A stronger follow-up
needs harder coding tasks, actual edits and execution, broader models, more
rounds and known billing prices before choosing dual mode as a universal default.

The [0.70.3 diagnostic results](evaluations/reasoning-0.70.3.md) retain the paired
grades, latency and usage from the first complete validated sample.
