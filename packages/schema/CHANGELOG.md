# @reddb-io/redcode-schema

## 1.23.0

### Minor Changes

- edae950: Design mode keeps track of feedback rounds and verifies each round in one job.
  - **Rounds and note statuses.** Review notes sent from the browser are recorded on the design document: notes arriving before a revision answers them form one round, and the first `design_preview` after them closes it. Every note carries a durable status (`open`, `resolved`, `partial`, `unresolved`, `accepted`) that the agent records with `design_document update notes: [{feedback, index, status, reason?, evidence: {job}}]`; the evidence copies the verify job's capture and findings for that note.
  - **One verify per round.** `design_export` gains `format: "verify"` (optional `round`, latest by default). In one job it renders the new revision and, for each note of the round, locates its element by `data-design-id`, selector or XPath in its variant, parameters and screen, captures a focused crop on the revision the note was taken on and on the new one, runs the scenarios of that screen and axe and layout checks scoped to the element's container, and reports one line per note, including "element not found" when it disappeared. Only a new serious or critical violation blocks a note; what the container already had before the fix is reported as pre-existing. Every note of the round is verified, each within its own time budget, and finished notes are kept even when a later one times out. `design_jobs` prints the per-note lines with the capture paths to cite and names notes that joined the round after the verify ran.
  - **Review page.** The conversation feed shows a verify's verdict per note (pass, findings, missing) with a link to the report and its captures; a "Feedback rounds" section lists every note with its status and reason, and a partial or unresolved note goes into the next round with one click.
  - Both runtimes (TUI and `redcode design`) and both conversation feeds carry the new entries. Restoring an older revision keeps the review's rounds and statuses. Existing documents without rounds decode unchanged.

## 1.22.0

### Minor Changes

- 6d14532: v2 SDK clients now receive `session.status`, and the v2 runner reads the guard config keys.
  - **Status on the v2 event stream:** `session.status` is part of the v2 event protocol. It carries the same busy (with phase, tool, step and since), retry and idle shapes as legacy. `/api/event` used to skip these events, so SDK Next clients could not tell a busy session from an idle one. The deprecated `session.idle` event stays legacy-only.
  - **Guard config in v2:** `experimental.loop_guard`, `experimental.tool_timeout` and `experimental.turn_stall` are now valid in v2 config. The v2 runner (used by `redcode design`) applies them per turn, exactly as the legacy runtime does. Setting `false` turns a guard off. Without these keys, v2 keeps the legacy defaults.

- db75a4d: Progressive tool discovery for the v2 runtime: `redcode design` now defers MCP and Design tools behind `tool_search`, as the legacy runtime already did.
  - **Deferral.** With `experimental.tool_search`, MCP tools are held back once their schemas exceed the threshold (default 3000 estimated tokens) and Design tools are held back outside a Design context. The deferred tools are replaced in the advertised list by a single `tool_search` tool, which loads them by keyword or exact name; a loaded tool is advertised from the next step and stays loaded for the rest of the session.
  - **The index is its own system part.** The list of deferred tools is sent as a system part rather than in the tool description, so a server that connects or disconnects changes that text instead of rewriting — and re-billing — the cached tools block.
  - **Provider-native search.** On Anthropic Messages models that support it, the deferred definitions are sent flagged with `defer_loading` next to the provider's own search tool instead of the client-side one, so the provider loads matches itself and the tools block stays cached. `experimental.tool_search.native` controls it (`"auto"` by default, restricted to an allowlist of Claude 4.5-and-later models). A provider that refuses the feature does not take the turn down with it: the step is replayed with the client-side tool, and the model is remembered as unsupported for the rest of the process. A tool reference the provider cannot resolve falls back for that step only, since it comes from the session's own history rather than from missing support.
  - **The advertised order is the activation order.** Tools that can never be deferred come first, then `tool_search`, then everything loaded so far in the order this session loaded it. Loading one more tool appends to the list instead of reshuffling it, which is what keeps the provider's cached tools prefix valid — the saving the whole feature exists for.
  - **Compaction keeps what was loaded.** A v2 compaction message now records the tools loaded through `tool_search` and whether MCP deferral had tripped, so a compaction no longer silently sends every loaded tool back behind the search tool.

  The shared half of tool search (what to defer, how the index reads, what one search call answers) moved into `@reddb-io/redcode-core`; the legacy runtime re-exports it and keeps its AI SDK bookkeeping, so legacy behaviour is unchanged.

## 1.21.0

### Minor Changes

- 4636b64: Session monitors can now wait on an HTTP endpoint, a file or a process natively, without a shell and on every platform: call the `monitor` tool with `action: "probe"` and an `http` probe (status, `json_path` with `equals`/`contains`/`regex`, same-host redirects only, 1 MB and 10 s bounds, `{env:NAME}` header values that ask a separate `env` permission per variable and host and are never shown), a `file` probe (`exists`, `missing` or `changed`, with `min_size`) or a `process` probe (`running` or `exited`, by exact executable `name`, by command line with `match: "cmdline"`, or by `pid`, among the current user's processes). Regular expressions run in a worker with a hard timeout, so a catastrophic pattern cannot freeze the runtime. An http probe asks the `webfetch` permission, a file probe asks `read` and `external_directory` (symlink targets included), and a process probe needs none; a poll longer than 10 minutes is still approved every time. Command polls gain `success_regex`, `failure_regex` and `until: "changed"`. Poll checks are now spread by a small random jitter (`jitter: false` keeps exact intervals), the last check always starts before the deadline, and a finished monitor's resume message states what matched. The sleep-polling guard offers the matching probe for `curl -f`, `test -f`/`[ -e ]` and `pgrep` loops, and `/monitors` shows probe monitors with their schedule.

## 1.20.1

### Patch Changes

- d9dcc88: Latency and output speed on the panel

  Every assistant message now records when its first streamed chunk arrived (`time.first`). The TUI footer shows the last reply's latency and its output rate next to context and cost — `1.2s · 84 tk/s` — and the app shows both in the context tooltip and the context tab. Speed counts output plus reasoning tokens from the first chunk to completion; latency is the wait from the request to that first chunk. Messages from before this release show neither rather than a guess.

## 1.20.0

### Minor Changes

- 68c96b4: Write down every time a guard intervenes, so the thresholds can be argued from evidence

  Five guards ship in 0.14.0 — the inactivity watchdog, tool deadlines, the loop guard, the step budget, the bounds on naming and compacting — and every threshold in them was chosen by argument, because there was nothing to measure. Each intervention is now recorded with which guard fired, what it acted on, and what it did, and published as a live `session.next.guard.tripped` event. `redcode debug guards` reads it back: counts per guard and action over the last week, loudest first, plus the most recent trips. An empty report says so in words, because "nothing fired" and "nothing was collected" are different answers.

## 1.19.0

### Minor Changes

- 82bb18a: Say what a busy session is actually doing

  `session.status` reported `busy` as a bare tag, so the TUI had to reverse-engineer the phase from message parts and every other client got nothing at all. `busy` now carries an optional phase (preparing, thinking, writing, tool, compacting), the tool being run, the step number, and when the phase started. The fields are additive: readers that discriminate on `type` alone are unaffected. The TUI uses them for the window the parts cannot describe — before the first byte arrives — and shows the step number, so a turn on its eighth step no longer looks the same as one that just started.
