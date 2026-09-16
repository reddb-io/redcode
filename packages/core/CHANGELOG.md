# @reddb-io/redcode-core

## 1.25.1

### Patch Changes

- Updated dependencies [edae950]
  - @reddb-io/redcode-schema@1.23.0
  - @reddb-io/redcode-design@0.0.3
  - @reddb-io/redcode-llm@1.19.2

## 1.25.0

### Minor Changes

- 31a6f73: Monitors for the v2 runtime: `redcode design` can now wait on an HTTP endpoint, a file or a process in the background instead of holding the turn.
  - **The `monitor` tool.** `action: "probe"` starts a native probe — an http probe (status, `json_path` with `equals`/`contains`/`regex`, `{env:NAME}` headers), a file probe (`exists`, `missing`, `changed`) or a process probe (`running`, `exited`) — and `list`, `get`, `wait` and `cancel` manage what is running. The probe releases the turn, checks in the background every `interval_ms`, and resumes the session with the result once the condition holds or `deadline_ms` passes. It reuses the monitor runtime and background-job service that already live in core, so nothing about how monitors run or recover changed.
  - **The result arrives as a queued input**, never as a steer, so it cannot land inside a turn the person started. Whether it wakes the session is decided when the result arrives, not when the monitor started: a goal that is paused, blocked or waiting by then leaves the result queued for the person instead of resuming on its own. The message id is derived from the monitor id, so a redelivery after a restart admits nothing new.
  - **A session parks while a monitor watches.** With a monitor still waiting on a condition, the runner stops injecting todo nudges and goal continuations and lets the session go idle; the monitor's own result starts the next turn. Only monitors waiting on a condition park.
  - **Permissions.** An http probe asks `webfetch` for its URL, and each `{env:NAME}` header asks a separate `env` permission per variable and host. That ask is forced: no catch-all rule, no saved "always" and no yolo mode can answer it, because a secret leaving the machine should never be settled by an earlier decision about something else. A file probe asks `read`, plus `external_directory` when it points outside the location, and re-checks after every poll that its symlinks still lead somewhere approved. A process probe asks nothing, but any poll longer than ten minutes is approved every time.
  - **The shell polling guard now offers a probe.** A `curl`, `test -f` or `pgrep` wait loop that a native probe can express is refused with the matching `monitor` call. Command polls still get the check-once refusal, because starting one needs the shell tool's own `monitor` parameter, which the v2 shell tool does not have.

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

### Patch Changes

- Updated dependencies [6d14532]
- Updated dependencies [db75a4d]
  - @reddb-io/redcode-schema@1.22.0
  - @reddb-io/redcode-design@0.0.2
  - @reddb-io/redcode-llm@1.19.1

## 1.24.0

### Minor Changes

- 4636b64: Session monitors can now wait on an HTTP endpoint, a file or a process natively, without a shell and on every platform: call the `monitor` tool with `action: "probe"` and an `http` probe (status, `json_path` with `equals`/`contains`/`regex`, same-host redirects only, 1 MB and 10 s bounds, `{env:NAME}` header values that ask a separate `env` permission per variable and host and are never shown), a `file` probe (`exists`, `missing` or `changed`, with `min_size`) or a `process` probe (`running` or `exited`, by exact executable `name`, by command line with `match: "cmdline"`, or by `pid`, among the current user's processes). Regular expressions run in a worker with a hard timeout, so a catastrophic pattern cannot freeze the runtime. An http probe asks the `webfetch` permission, a file probe asks `read` and `external_directory` (symlink targets included), and a process probe needs none; a poll longer than 10 minutes is still approved every time. Command polls gain `success_regex`, `failure_regex` and `until: "changed"`. Poll checks are now spread by a small random jitter (`jitter: false` keeps exact intervals), the last check always starts before the deadline, and a finished monitor's resume message states what matched. The sleep-polling guard offers the matching probe for `curl -f`, `test -f`/`[ -e ]` and `pgrep` loops, and `/monitors` shows probe monitors with their schedule.

### Patch Changes

- 6c299c7: The sleep-polling guard now refuses wait loops around local checks, such as `until grep -q PASSED ci.log; do sleep 5; done`, when their total wait is 30 s or more or cannot be read off the command. Before, it only caught loops around remote status commands. The refusal suggests polling the check itself: every 1–2 s with a 2-minute deadline for an open-ended readiness loop, done when it exits 0, and it names any commands that came after the wait. A `while` condition is inverted so that exit 0 still means done. Batch loops that act on each item, and retries bounded under 30 s by a counter, an iteration count or `timeout`, still run.
- Updated dependencies [4636b64]
- Updated dependencies [92e03f2]
  - @reddb-io/redcode-schema@1.21.0
  - @reddb-io/redcode-llm@1.19.0
  - @reddb-io/redcode-design@0.0.1

## 1.23.1

### Patch Changes

- ef04f6c: The v2 core `bash` tool (used by `redcode design`) now refuses sleep polling loops, blocking watchers and long sleeps before asking or running. Without monitors in v2, the refusal offers a single status check to run now and report, or a bounded wait under 30 s. The detector moved to `@reddb-io/redcode-core/tool/shell-polling` and the legacy shell tool uses it unchanged.

## 1.23.0

### Minor Changes

- 9df9f10: The project's own directory is `.red/code`, and the user's is `~/.red/code`

  Redcode's files inside a repository move from `.redcode` to `.red/code`, beside whatever else the RedDB family keeps under `.red/`: config, agents, skills, themes, plugins, plans and designs. The user-level home moves the same way, from `~/.red/redcode` to `~/.red/code`, and is renamed once on the next start; if that cannot be done the old directory is kept and used as it is. An older Redcode run after that rename does not see the move and starts a new, empty home.

  Nothing in a repository is migrated. `.redcode` and `.opencode` are still read, and a file already in one is still written there, so a repository that has either keeps working and a plan or design written before the change is found where it was left. When more than one exists, the newer name wins: `.opencode`, then `.redcode`, then `.red/code`.

## 1.22.0

### Minor Changes

- fce66aa: Design mode: real image attachments, a self-paint check, and Tailwind, DaisyUI and Mermaid shipped for prototypes

  Images attached to a note — from the composer or from the card on an element — are uploaded to a content-addressed store under the data directory (owner-only files, magic bytes decide the type, PNG/JPEG/WebP only), and reach the agent as files on disk. Limits are configurable under `experimental.design.attachments`: 10 MiB per image, 4 per note, 25 MiB per note, a 7-day TTL and a 512 MiB quota swept hourly without ever touching an image a turn may still be reading. A send whose images cannot be honoured is refused whole, and the page says which cap was hit. `design_preview` adds a note when a page never paints its own surface, since text styled for an assumed dark or light host can be invisible. Prototypes have no network, so redcode now serves Tailwind's browser runtime, DaisyUI (with its themes) and Mermaid at `/design/vendor/`, and the prompt states the design-direction rule: what the user asked for, then the project's own design system, then these.

- 8993328: Design mode: a self-contained export, and the review from another device

  `design_export` (and ⋮ → Export standalone HTML on the review page) writes the prototype as one HTML file with its own stylesheets, classic scripts, images, fonts and media inlined, along with the Tailwind, DaisyUI and Mermaid redcode serves, so it opens from disk or anywhere with no redcode running. Remote references are left for the browser; nothing is fetched, and every local read is confined to the prototype directory by real path, so a symlink cannot carry an outside file into a page that may be shared. What could not be inlined is listed for the agent and counted for the person. The transform is lavish-axi's export bundler, vendored whole with its tests. Caps under `experimental.design.export` (10 MB per asset, 25 MB per export). When the server listens beyond loopback, `design_preview` prints the URL a phone on the same network can open and the page offers it under ⋮; the review surface now answers only under names that are this machine (loopback, the bound hostname, its addresses and its own name, plus `experimental.design.hosts`), so a page elsewhere that resolves its name here cannot drive it.

- 6e2e844: Design mode: a passive layout audit with an inbox the person triages

  The prototype now audits its own layout after fonts, geometry and finite animations settle: text clipped by its container, controls cut off or outside the viewport, text off-screen, a page that scrolls sideways, text covered by an opaque sibling. Findings survive only if two samples agree, and every pass reports its own completeness. They land in a "Layout issues" inbox on the review page — badge, drawer, select, queue, dismiss, reveal — and nothing in it reaches the agent until the person queues it, when it becomes one ordinary note. A warning is cleared only by a complete pass on a newer revision that no longer finds it; a failed pass, a different viewport or a reload in flight never clears anything, and a dismissal lasts one revision. Every frame load is named by a token so a pass from a replaced frame is discarded. The page holds the prototype behind a short curtain until its first pass (`experimental.design.gate`, `gate_timeout`, or `?gate=0` for one tab), asks the server whether the document can be served when the frame stays silent, and the one report that does wake the agent unasked is a prototype that cannot be shown at all (`<artifact-failures>`). Viewport classes can be narrowed with `experimental.design.viewports`; a class left out has its warnings marked obsolete rather than resolved.

## 1.21.1

### Patch Changes

- Updated dependencies [d9dcc88]
  - @reddb-io/redcode-schema@1.20.1
  - @reddb-io/redcode-llm@1.18.21
  - @reddb-io/redcode-plugin@1.18.20

## 1.21.0

### Minor Changes

- a4e53f8: Real fan-out: every subtask on a message runs, together; background subagents on by default, capped per session

  A message carrying several subtasks used to run only the last one — the assistant message the first subtask left behind hid the rest. Now all of them run, `experimental.subtask_concurrency` at a time (default 4), and their results land in the order they were asked. Background subagents no longer need `REDCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`; set it to `false` to turn them off. One session may have `experimental.background_subagents_max` (default 4) running at once; past that the task tool refuses and tells the model to wait or run the task inline. Cancelling the run — Ctrl+C, `/goal-drop` — still cancels every child.

- f53faea: `/goal`: a definition of done the harness pursues until it holds

  A goal — free text plus optional `verify:`, `constraints:`, `boundaries:`, `stop when:` and `gate:` lines — lives in the session's metadata and is re-rendered into every turn, so compaction cannot paraphrase it away. At the end of each turn, gates run and a small judge reads the objective against the last answer: CONTINUE is one more turn inside the same run, DONE ends it with the goal met, BLOCKED and the turn budget (default 20) pause it with the reason, WAIT parks it while background work runs. The agent claims completion through `goal_complete` with evidence the judge reads; an unsupported claim comes back as work. Ctrl+C and a new process pause the goal; only `/goal resume` brings it back. Every decision is a row in `redcode debug guards`. Endpoints: `GET/POST /session/:id/goal`, `…/goal/pause|resume|drop|budget`.

### Patch Changes

- @reddb-io/redcode-plugin@1.18.19

## 1.20.1

### Patch Changes

- be2fcd5: Build is red, plan is gold, design is cyan — everywhere, including the loading bar

  The brand theme had set primary, secondary and accent all to RedDB reds, and agents took their colour from that palette by position, so every mode looked the same. Each built-in agent now names its colour: build red, plan gold, design a cyan a shade under bright. The TUI's loading scanner takes its head from the agent's own colour instead of the theme accent, so it changes with the mode again. The app gets a design token to match.

- b331e2e: Ported from upstream: tolerate Anthropic's thinking block binding on Claude 5.1+

  Fable 5.1 binds each thinking signature to the system prompt, tool list and messages above it, and rejects the request when any of that changes between turns. Requests to Claude 5.1+ (direct, Vertex, Bedrock) now ask the API to drop the affected blocks instead of failing, via patched `@ai-sdk/anthropic` 3.0.111 and `@ai-sdk/amazon-bedrock` 4.0.166; the blocks Anthropic reports dropping are logged. Set `thinking.blockBinding: false` (or `reasoningConfig.blockBinding: false` on Bedrock) in the model's provider options to opt out.

- 4ad8dc9: Ported from upstream: Azure CLI authentication, Codex model filtering, Copilot session header, GitLab provider bump

  Azure can authenticate through the Azure CLI, without a Bun dependency, and its model discovery is gone (it logged to stdout and added nothing); Codex accepts integer GPT versions and compares them by major and minor; GitHub Copilot sends the interaction id with the session; `gitlab-ai-provider` 6.13.0.

- f9100dc: Ported from upstream: session, provider list, database and apply-patch fixes

  `/connect` shows the providers that are actually authenticated; session request headers are restored after compaction and the parent session header is sent; a database whose legacy migration history is missing is recovered instead of refusing to start; `apply_patch` no longer emits an empty move path.

- 150c010: Ported from upstream: seven provider and stream fixes

  Cerebras keeps its completion limit; Vertex multi-region models route through the regional endpoint; non-native providers behind Cloudflare AI Gateway go through its REST API, and Anthropic's dashed slug is sent correctly through it; Bedrock reasoning that cannot be replayed is filtered before caching, and a `none` reasoning effort is accepted; a cancelled SSE reader no longer surfaces an unhandled rejection.

- 9c22b55: Ported from upstream: console device URLs, GitHub OIDC subjects, and test hygiene

  Console device-auth URLs resolve correctly; the GitHub app accepts immutable OIDC subjects; development runs on native runtime conditions instead of `--conditions=browser`; a test guards that every patched dependency is at the version its patch targets (and drops a patch for a version nothing uses); the core test preload disables npm audits.

## 1.20.0

### Minor Changes

- c5cf65a: Design mode: work out what something should be by building it, then turn that into a plan

  A third mode beside build and plan. The `design` agent writes a prototype into `.redcode/designs/`, opens it with `design_preview`, and the user talks back from either side: alt-click an element in the browser (or the app's new Design tab) and say what should change, or just say it in the chat. Each preview carries craft notes when the prototype reaches for the patterns reviewers recognise as generated. `design.json` beside the prototype keeps the decisions settled and the questions open, and `design_exit` writes the plan from it. Behind `REDCODE_EXPERIMENTAL_DESIGN_MODE`.

## 1.19.0

### Minor Changes

- 68c96b4: Write down every time a guard intervenes, so the thresholds can be argued from evidence

  Five guards ship in 0.14.0 — the inactivity watchdog, tool deadlines, the loop guard, the step budget, the bounds on naming and compacting — and every threshold in them was chosen by argument, because there was nothing to measure. Each intervention is now recorded with which guard fired, what it acted on, and what it did, and published as a live `session.next.guard.tripped` event. `redcode debug guards` reads it back: counts per guard and action over the last week, loudest first, plus the most recent trips. An empty report says so in words, because "nothing fired" and "nothing was collected" are different answers.

- 7246ae1: Notice a call that never stops being made, even when the answer keeps changing

  Comparing results is what keeps the loop guard off polling's back, and it was also the way through it: an answer carrying a timestamp, a pid or a temporary path never repeats byte for byte, so the same call could run all turn without ever counting as repetition. At twelve identical calls in a row the repetition is mentioned once — the call still runs, because polling looks exactly like this and is sometimes right. Configurable as `experimental.loop_guard.nudge_at`.

### Patch Changes

- Updated dependencies [68c96b4]
  - @reddb-io/redcode-schema@1.20.0
  - @reddb-io/redcode-llm@1.18.20

## 1.18.19

### Patch Changes

- 78d1b03: Bound the model calls a turn makes that are not the turn itself

  Naming a session and compacting the conversation both call a provider outside the step loop, where the turn's inactivity watchdog cannot see them: one runs before any step handle exists, the other creates a processor of its own. A provider that stopped answering during either held the turn open with nothing on screen and no error. Both now give up — naming after two minutes, compacting after ten — and say so. A session keeping its default name is a far smaller loss than a turn that never starts. Configurable via `experimental.aux_timeout`.

- 8c43207: Notice when the model is repeating itself, and say so instead of asking the user

  The old detector compared the last three parts of a single assistant message and required byte-identical serialized input, so one interleaved reasoning part — which reasoning models emit constantly — reset it permanently, a loop spanning steps was invisible, and when it did fire it asked a question whose wait had no bound: the only defence against a loop was itself a way to hang. It now looks across the whole turn, counts only calls that returned the same result (identical calls with different results are polling, and are left alone), and answers the repeated call itself with a correction quoting the model's own arguments and the answer it keeps ignoring. If the correction changes nothing, the turn ends. Nobody is asked anything. Configurable via `experimental.loop_guard`; a `doom_loop: "allow"` permission rule still turns it off.

- 603d8c7: Ask for a report before the step ceiling instead of cutting the turn off at it

  The turn ceiling was a cliff: at step 200 the turn stopped and everything the model had worked out but not yet written down went with it, leaving the user told to "send another message to continue" with nothing to base it on. The last steps before the wall are now spent the way `agent.steps` already spends its own: tools off, a summary of what was done, what is left, and what to do next. The wall itself is unchanged, for a model that will not yield. Configurable via `experimental.turn_steps`.

- 86b2250: Stop a tool that never returns instead of letting it hold the turn open

  Most tools carry no bound of their own, so a read on a dead mount or an MCP call to a process that went away kept a turn running with no output and no error — and the turn's inactivity watchdog could not help, because a tool in flight is deliberately counted as work. Tool calls now have a ten minute backstop, reported to the model as an ordinary tool failure it can react to. Tools that legitimately take as long as they take are exempt (`shell`, `bash`, `question`, `task`), and time spent waiting on a permission prompt is not charged against the tool. Configurable via `experimental.tool_timeout`, `false` to disable.

- Updated dependencies [82bb18a]
  - @reddb-io/redcode-schema@1.19.0
  - @reddb-io/redcode-llm@1.18.19
