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
