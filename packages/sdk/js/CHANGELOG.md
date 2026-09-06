# @reddb-io/redcode-sdk

## 1.19.1

### Patch Changes

- d9dcc88: Latency and output speed on the panel

  Every assistant message now records when its first streamed chunk arrived (`time.first`). The TUI footer shows the last reply's latency and its output rate next to context and cost — `1.2s · 84 tk/s` — and the app shows both in the context tooltip and the context tab. Speed counts output plus reasoning tokens from the first chunk to completion; latency is the wait from the request to that first chunk. Messages from before this release show neither rather than a guess.

## 1.19.0

### Minor Changes

- f53faea: `/goal`: a definition of done the harness pursues until it holds

  A goal — free text plus optional `verify:`, `constraints:`, `boundaries:`, `stop when:` and `gate:` lines — lives in the session's metadata and is re-rendered into every turn, so compaction cannot paraphrase it away. At the end of each turn, gates run and a small judge reads the objective against the last answer: CONTINUE is one more turn inside the same run, DONE ends it with the goal met, BLOCKED and the turn budget (default 20) pause it with the reason, WAIT parks it while background work runs. The agent claims completion through `goal_complete` with evidence the judge reads; an unsupported claim comes back as work. Ctrl+C and a new process pause the goal; only `/goal resume` brings it back. Every decision is a row in `redcode debug guards`. Endpoints: `GET/POST /session/:id/goal`, `…/goal/pause|resume|drop|budget`.
