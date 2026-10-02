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

## Session satisfaction in S2 prompts

Dual mode adds a `<session-satisfaction>` system block to each logical Step's S2
request, including retries and rebuilt requests. It folds the last 100 persisted
evaluations with the same satisfaction calculation as the TUI: recent confident
`user_feedback` and `frustration` classifications plus guard stops and recoveries.
Observe evaluations are excluded. There is no extra model call or stored score.

The integer score runs from **0 (low satisfaction) to 5 (high satisfaction)**.
Fewer than three reliable classifications produces a null score and unknown stage
and trend. The block includes the reliable sample count, stage, stops and recoveries.
Trend compares the current reading to the reading before the newest reliable sample,
including only interventions at or before that preceding sample for the comparison;
a change greater than 0.1 on the internal -1 to 1 scale is improving or worsening.
Smaller changes are stable; without a preceding valid reading, trend is unknown.

Low or worsening satisfaction asks S2 to revisit corrections and tool evidence,
change a failed approach and verify results. Mood is advisory evidence, not a verdict
on correctness or authorization to change goals, permissions, model, effort or budget.
Single and Observe omit this guidance. If collection fails, execution continues
without the block and logs the failure. Its effect on quality still needs evaluation.

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
