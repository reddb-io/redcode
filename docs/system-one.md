# S1 and S2 reasoning roles

Use `/connect` to connect a provider, then `/dual` inside the TUI or `redcode setup`
from the shell. `/setup` remains a compatibility alias. Configuration belongs to the connected server.

- **S2 / System Two** generates responses and performs agent work.
- **S1 / System One** evaluates candidates using typed TypeSafe/JEV questions.
- **Single** reasoning uses S2. **Dual** reasoning adds S1 evaluation.

The setup selects an enabled text model for S2, discovers evaluator models for S1,
and checks the connections before saving. Cancelling setup leaves saved settings
unchanged. A blank S1 API key reuses credentials when the selected connection supports it.
Sources and candidates are sent to the selected evaluator in dual mode.

The S2 connection picker offers **Use current connection and model** when the
session's selected model and connection are still available. Choosing another
connection continues to its model list. S1 always comes from its connection's catalog.
Connection-test Retry resumes with the failed role; a successful S2 probe is retained.

For RedRouter, the selected S1 model's `supported_endpoints` or the router's
`systemone.endpoint` identifies `systemone` or `decisions`. Setup tests that endpoint
and saves it with the evaluator, so subsequent evaluations use one route. Without
endpoint metadata, setup tries `systemone`, and only a 404 or 405 permits trying
`decisions`. Authentication, invalid-request and upstream failures do not trigger
alias switching. HTTP status, response bytes and latency remain visible.
An empty filtered model list also checks models advertised in `/v1/capabilities`.
Routed JEV versions are recognized without a fixed list of version numbers.

### OpenRouter and RedRouter endpoints

The native OpenRouter evaluator defaults to `https://openrouter.ai/api/v1/systemone`,
using the typed `model`, `state` and `questions` payload. The AI SDK already uses
this route; the `/dual` runtime now follows the same default. A selected connection's
configured base URL takes precedence over older connection metadata. Saved official
`https://openrouter.ai/api/alpha` evaluators remain supported through `/decisions`;
that alpha operation is distinct from the versioned `/api/v1/systemone` route.

RedRouter's `/v1/systemone` and `/v1/decisions` share its System One handler.
Discovery keeps the first recognized entry in a model's `supported_endpoints` and
accepts both endpoint names and `/v1/` paths from `systemone.endpoint`. Full routed
IDs, including `red/red/openrouter/typesafe/jev-1.13`, are sent unchanged to the router.
Versioned JEV evaluators belong to S1; `typesafe/jev-router` is a generative chat model
and remains eligible for S2.

Redcode reads discovery again for each detection or model-list request. Any discovery
cache and key-scoped invalidation belong to RedRouter. Listing a model establishes
catalog access, not working credentials or a successful evaluation. Setup must still
test the selected route before saving a working evaluator.

The bundled models.dev provider catalog includes specialized entries through
`api.json?type=all`. Their `type` and `canonical_model_id` are retained separately
from executable provider IDs. Specialized entries are excluded from S2. For
OpenRouter, Cloudflare AI Gateway and Vercel, S1 discovery lazily reads compatible
JEV decision offerings from the matching provider in the bundled snapshot, with
the adapter preset as a fallback. This does not start a remote catalog refresh.
Other classifiers need a compatible typed-question adapter before they
can be offered as S1. Catalog availability still requires a successful connection
probe. RedRouter always uses its selected key's remote catalog and capabilities;
the public snapshot never fills an empty Router list.

Router diagnostic codes appear alongside HTTP status for missing endpoints, refused
credentials, unavailable models or connections, transport failures and invalid typed
answers. Upstream error text is not reflected in those messages. A 502 alone does not
identify its cause, and switching the router's public aliases cannot repair a failure
in its upstream adapter. Live upstream credentials and forwarding still require a
separate end-to-end check.

## Asynchronous prompt classification

Prompt classification gathers its sources and evaluates them in the background,
alongside S2. The first logical Step no longer waits up to five seconds for S1.
At subsequent Step boundaries, the runner reads the persisted classification for
the latest delivered user message and the effective reasoning mode. In dual mode,
reliable guidance enters a `<system-one-steering>` system block and can inform
Router request guidance. It never changes a Physical Attempt already streaming.

The advisory identifies its evaluation and user message. S2 checks it against the
current request and completed work rather than repeating or discarding valid work.
A newer delivered user message supersedes the old classification for steering.
The old evaluation remains in history, including its feedback and frustration
signals. Classification does not enqueue a synthetic prompt, wake idle execution,
reset the agent's Step allowance or grant permissions.

A result that arrives after Session completion still persists while the Location
runtime remains alive, without starting another S2 Step. Shutdown may interrupt
unfinished advisory work. Single mode does not classify; Observe records results
asynchronously without injecting steering or satisfaction into S2. Final response
review, goal checks and mandatory approval policies retain their existing behavior.

This removes a known wait from execution. It does not yet establish lower end-to-end
latency, better accuracy or compliance with the measured 2x cost criterion.

## Accumulated session friction in S2 prompts

Dual mode adds a `<session-frustration>` system block to each logical Step's S2
request, including retries and rebuilt requests. The Context thermometer and S2 use
the same chronological fold of the last 100 persisted evaluations: confident
`user_feedback` and `frustration` observations plus guard stops and verified recoveries.
Observe evaluations are excluded. There is no extra model call or stored score.

This measures accumulated friction with the agent's work, not general sentiment,
personality or emotion. S1 reads the request with recent conversation history to
identify unmet expectations, repeated corrections and failed attempts. Profanity,
urgency or a complaint about an external system alone does not establish agent failure.
A calm repeated correction can be stronger evidence than an emotional new request.

Corrections add 0.2, rejection adds 0.35, and explicit friction contributes up to 0.4
per reliable prompt, using the stronger failure signal instead of counting it twice.
Explicit confirmation that the result works subtracts 0.15 when no current friction
is reported. Neutral messages, including "ok", "go" and "continue", hold the reading;
missing or unreliable observations contribute nothing. Guard stops add 0.1 and
verified recovery subtracts 0.05. Clamp each observation to the internal 0 to 1 range,
so past approval cannot compensate for a later failure. These are heuristic weights,
not empirically calibrated measures of patience or correctness.

The integer score runs from **0 (no accumulated friction) to 5 (critical friction)**.
The TUI displays a single vertical bar (`▯ ▁ ▂ ▄ ▆ █`) filling upward as friction rises,
without a label or numeric score. Fewer than
three reliable classifications produces an unknown score, stage and trend (`?` in the TUI). The block
includes the reliable sample count, stage, stops and recoveries. Trend compares the
current reading to the reading before the newest reliable sample, including only
interventions at or before that preceding sample. A change greater than 0.05 on the
internal scale is heating or cooling; smaller changes are stable. Without a preceding
valid reading, trend is unknown. The retained history bounds this reading; it is not
an unlimited lifetime frustration ledger.

Background classifications contribute once persisted, including results that arrive
after completion or are superseded for steering. A pending classification contributes
no invented sample. High or heating temperature asks S2 to review the sequence of
failed attempts, identify the unmet requirement, change the failed approach and verify
results. If the desired outcome remains ambiguous after reading the conversation,
ask one focused clarification while continuing independent work. Do not ask the user
to repeat an already clear requirement. Apologies and claimed completion do not
count as recovery.

The thermometer is advisory evidence. It does not authorize changes to goals,
permissions, mode, model, effort or budget. Single and Observe omit this guidance.
If collection fails, execution continues without the block and logs the failure.
Its effect on quality still needs evaluation. `/satisfaction` remains the visibility
control for compatibility with existing settings.

`/intelligence` shows the current TUI model separately from the saved global S2
model, the effective reasoning mode and its source, and recent session evaluations.
Select an evaluation to inspect its answers and issues. The S1 footer indicator
opens this panel; a warning indicates an unavailable, inconclusive or rejected
latest evaluation. Unavailable history is shown as an error, not an approval.

A server `REDCODE_REASONING` override takes precedence over the saved reasoning mode.
Explicit session/TUI model selections can differ from the saved global S2 default.

Design conversations and evaluation history remain in the Redcode database.
The current HTTP endpoints are `/api/experimental/intelligence`, its `/models`,
`/probe` and `/history` subroutes. Requests use the server's normal authentication.
