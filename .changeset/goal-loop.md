---
"@reddb-io/redcode": minor
"@reddb-io/redcode-core": minor
"@reddb-io/redcode-sdk": minor
---

`/goal`: a definition of done the harness pursues until it holds

A goal — free text plus optional `verify:`, `constraints:`, `boundaries:`, `stop when:` and `gate:` lines — lives in the session's metadata and is re-rendered into every turn, so compaction cannot paraphrase it away. At the end of each turn, gates run and a small judge reads the objective against the last answer: CONTINUE is one more turn inside the same run, DONE ends it with the goal met, BLOCKED and the turn budget (default 20) pause it with the reason, WAIT parks it while background work runs. The agent claims completion through `goal_complete` with evidence the judge reads; an unsupported claim comes back as work. Ctrl+C and a new process pause the goal; only `/goal resume` brings it back. Every decision is a row in `redcode debug guards`. Endpoints: `GET/POST /session/:id/goal`, `…/goal/pause|resume|drop|budget`.
