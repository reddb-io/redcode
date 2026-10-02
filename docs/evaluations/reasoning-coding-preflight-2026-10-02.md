# Coding campaign preflight — 2026-10-02

The coding comparison has not started. No paid inference was requested, and
there is no new accuracy, latency or cost-ratio result for single versus dual.
The [raw preflight record](reasoning-coding-preflight-2026-10-02.json) contains
the measured HTTP status, full-response latency and byte counts.

The configured Router connection at port 25050, running version 0.57.7,
returned an empty catalog on all four discovery requests:

| Route                              | HTTP | Latency | Bytes | Models |
| ---------------------------------- | ---: | ------: | ----: | -----: |
| `/v1/models`                       |  200 |   34 ms |    27 |      0 |
| `/v1/models/systemone`             |  200 |    7 ms |    50 |      0 |
| `/v1/models?capabilities=decision` |  200 |   50 ms |    27 |      0 |
| `/v1/models?capabilities=chat`     |  200 |   23 ms |    27 |      0 |

Read-only database checks found the configured key active, unrevoked and without
an expiry, with unrestricted model access in `storage.sqlite`. Both Router
databases contain six active provider connections and a matching key. This
rules out a missing persisted key or zero persisted active connections; it
does not establish which runtime catalog or permission adapter produced the
empty response. No Router configuration, permissions or service was changed.

The proposed comparison uses the currently selected Mimo V2.6 Pro and a second
S2, GPT-4.1 mini, each paired with JEV-1.13. These are provisional selections
until Router discovery verifies availability and inference verifies the
upstream response identities. The public OpenRouter catalog advertises both
S2s; it did not advertise the selected JEV ID in this check. Public pricing
does not establish the Router's billed rates or complete S1 accounting.

The dry-run plans 96 calibration executions: two model pairs, two rounds,
six cases, single and dual, and the baseline and verification experiments.
After selecting and freezing one experiment, the reserved split has another
48 executions across six different families. Selection must not be tuned on
those reserved results. The acceptance gate requires an accuracy improvement,
no case regression, independently graded repairs and complete known cost
within 2× both overall and for each matched single/dual execution.

Before paid execution, the Router must expose the selected models and the
absolute USD campaign budget must be supplied. Cache remains a Router
responsibility. An empty catalog is a preflight blocker, not evidence of
model quality or dual-reasoning effectiveness.
