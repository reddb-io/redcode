---
"@reddb-io/redcode": minor
---

Restore subagent supervision on the V2 engine. The subagent tool takes `scope`, `done_criteria` and `return_format` and hands them to the subagent after its prompt. With dual reasoning, System One reviews the brief before the subagent starts: a brief that needs revision fails the call with the issues and the questions to answer, and a second rejection for the same request lets it start with a warning. An unavailable System One never approves silently, and single reasoning checks the structure only. When the brief has structure, the result is checked against it (empty result, criteria never mentioned, no successful change, files changed outside the scope, failing verification commands), then by System One in dual reasoning, with one repair round in the same subagent. The verdict (verified, needs revision, inconclusive or unverified) is appended to the result the parent reads, kept on the task part and in the child session's metadata, and a result the stop-loss cut short is handed back as incomplete.

Cap subagent fan-out in code with `experimental.subagent_limits.concurrent` (foreground subagents in flight per session, default 4), `experimental.subagent_limits.per_request` (new subagents per user message, default 12), `experimental.background_subagents_max` (default 4) and `experimental.subtask_concurrency` (foreground subagents running at once, default 4); a call over a cap fails with the reason and what to do instead.

Subagent task rows in the TUI and task cards in the app show a verdict badge (✓ verified, ? inconclusive, ! needs revision, ~ unverified) and where the stop-loss left the subagent. Inside a subagent the TUI shows the brief it was launched under, collapsed to its goal until clicked, and its checkpoint history.
