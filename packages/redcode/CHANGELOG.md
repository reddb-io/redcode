# opencode

## 0.21.0

### Minor Changes

- d09acc5: Design mode is on by default, and `design_export` is available to the design agent

  The `REDCODE_EXPERIMENTAL_DESIGN_MODE` flag is gone: the `design` agent's tools — `design_preview`, `design_playbook`, `design_export`, `design_exit` — are always there, and the mode's system prompt is added whenever the design agent runs. The README gains a tutorial for the whole loop: starting, reviewing (annotations, images, live reload, layout issues, whiteboards, export, another device), finishing, the files it leaves, and the settings.

- 9df9f10: The project's own directory is `.red/code`, and the user's is `~/.red/code`

  Redcode's files inside a repository move from `.redcode` to `.red/code`, beside whatever else the RedDB family keeps under `.red/`: config, agents, skills, themes, plugins, plans and designs. The user-level home moves the same way, from `~/.red/redcode` to `~/.red/code`, and is renamed once on the next start; if that cannot be done the old directory is kept and used as it is. An older Redcode run after that rename does not see the move and starts a new, empty home.

  Nothing in a repository is migrated. `.redcode` and `.opencode` are still read, and a file already in one is still written there, so a repository that has either keeps working and a plan or design written before the change is found where it was left. When more than one exists, the newer name wins: `.opencode`, then `.redcode`, then `.red/code`.

### Patch Changes

- @reddb-io/redcode-server@1.18.26
- @reddb-io/redcode-tui@1.21.2

## 0.20.0

### Minor Changes

- fce66aa: Design mode: real image attachments, a self-paint check, and Tailwind, DaisyUI and Mermaid shipped for prototypes

  Images attached to a note — from the composer or from the card on an element — are uploaded to a content-addressed store under the data directory (owner-only files, magic bytes decide the type, PNG/JPEG/WebP only), and reach the agent as files on disk. Limits are configurable under `experimental.design.attachments`: 10 MiB per image, 4 per note, 25 MiB per note, a 7-day TTL and a 512 MiB quota swept hourly without ever touching an image a turn may still be reading. A send whose images cannot be honoured is refused whole, and the page says which cap was hit. `design_preview` adds a note when a page never paints its own surface, since text styled for an assumed dark or light host can be invisible. Prototypes have no network, so redcode now serves Tailwind's browser runtime, DaisyUI (with its themes) and Mermaid at `/design/vendor/`, and the prompt states the design-direction rule: what the user asked for, then the project's own design system, then these.

- 8993328: Design mode: a self-contained export, and the review from another device

  `design_export` (and ⋮ → Export standalone HTML on the review page) writes the prototype as one HTML file with its own stylesheets, classic scripts, images, fonts and media inlined, along with the Tailwind, DaisyUI and Mermaid redcode serves, so it opens from disk or anywhere with no redcode running. Remote references are left for the browser; nothing is fetched, and every local read is confined to the prototype directory by real path, so a symlink cannot carry an outside file into a page that may be shared. What could not be inlined is listed for the agent and counted for the person. The transform is lavish-axi's export bundler, vendored whole with its tests. Caps under `experimental.design.export` (10 MB per asset, 25 MB per export). When the server listens beyond loopback, `design_preview` prints the URL a phone on the same network can open and the page offers it under ⋮; the review surface now answers only under names that are this machine (loopback, the bound hostname, its addresses and its own name, plus `experimental.design.hosts`), so a page elsewhere that resolves its name here cannot drive it.

- 6e2e844: Design mode: a passive layout audit with an inbox the person triages

  The prototype now audits its own layout after fonts, geometry and finite animations settle: text clipped by its container, controls cut off or outside the viewport, text off-screen, a page that scrolls sideways, text covered by an opaque sibling. Findings survive only if two samples agree, and every pass reports its own completeness. They land in a "Layout issues" inbox on the review page — badge, drawer, select, queue, dismiss, reveal — and nothing in it reaches the agent until the person queues it, when it becomes one ordinary note. A warning is cleared only by a complete pass on a newer revision that no longer finds it; a failed pass, a different viewport or a reload in flight never clears anything, and a dismissal lasts one revision. Every frame load is named by a token so a pass from a replaced frame is discarded. The page holds the prototype behind a short curtain until its first pass (`experimental.design.gate`, `gate_timeout`, or `?gate=0` for one tab), asks the server whether the document can be served when the frame stays silent, and the one report that does wake the agent unasked is a prototype that cannot be shown at all (`<artifact-failures>`). Viewport classes can be narrowed with `experimental.design.viewports`; a class left out has its warnings marked obsolete rather than resolved.

- 448242c: Design mode: playbooks on demand

  A new `design_playbook` tool hands the agent lavish's seven playbooks — diagram, table, comparison, plan, code, input (collecting answers inside the page), slides — rewritten for redcode's review page and a prototype that has no network. The mode's prompt carries the router (open every playbook that matches before writing HTML) and the playbook itself is read on the turn that needs it, so the prompt stays short.

- 89356bb: Design mode: the conversation, live reload, ending the review, and a sheet on the phone

  The review page is now a conversation: what you send and what the agent replies, queued notes as pills, Send to Agent, Hold, and Send & End; a menu with the prototype's path, reload, a DOM snapshot copy, and End review. A change on disk reloads the prototype while someone is looking, and the page keeps the person's place, their unsent card text, and answers inside `data-redcode-question` across that reload — a note whose element disappears for two revisions is handed back as text, never lost. Everything a person wrote survives a reload of the page itself. The server streams reloads, the agent's replies and presence over `/design/:id/events`; who ended the review is remembered, a person's end is not reopened by the agent unless asked (`design_preview` gains `reopen`), and `design_exit` ends the review as the agent. The review's state lives in a sidecar beside the prototype and an index in the data directory, so a restarted server still knows an open tab. Below 860px the panel becomes a sheet raised from a dock.

- c7509de: Design mode reviews like lavish: annotate or explore, text ranges, table cells, Mermaid nodes

  The review client is now the lavish-axi loop, natively. Annotate mode is on by default (Cmd/Ctrl+I toggles explore; alt-click still annotates there); native controls keep working. A note can anchor to a text selection (with range anchors), a table cell (named by its visible row and column when that is provable), or a Mermaid node (by the diagram's own ids), and the agent reads each as such. Artifacts get `window.redcodeDesign` (`window.lavish` as an alias) with `queuePrompt`, `sendQueuedPrompts`, `endSession`, `setStatus`, `snapshot`, and `data-redcode-action` / `data-redcode-question` (lavish's names accepted too); an unsent answer for the same control replaces the earlier one. A send carries a bounded DOM snapshot after the notes, and can end the review. The shell replays scroll position and an unsent card draft after the prototype reloads, and adopts the prototype's title and icon.

- 3a6f023: Design mode: Mermaid diagrams open as whiteboards

  Every rendered diagram in a `.mermaid` (or `data-redcode-mermaid`) container gets an Excalidraw whiteboard beside it, and a Fullscreen action that opens the same one over the page: converted from the Mermaid source, drawn on and rearranged, autosaved beside the review's own state, and queued as one ordinary note carrying a summary of what changed (added, removed, moved, relabeled, drawn) plus the edited scene and a PNG preview on disk. The agent edits the Mermaid source in response; nothing is ever converted back. A scene saved for an older version of a diagram is never merged silently: the person chooses between re-converting and keeping their edits. The frames run sandboxed with no origin and no server access; the review page does every read and write, and only for a frame that proved a channel token minted for this prototype and its descent from the prototype frame. The bundle (Excalidraw, the converter with its exactly pinned Mermaid, React) is not in the binary: a release ships it as `redcode-whiteboard-<version>.tar.gz`, fetched into the data directory the first time a review needs it (`REDCODE_DISABLE_WHITEBOARD_DOWNLOAD=1` to never fetch, `REDCODE_WHITEBOARD_DIR` to point at a build); a source checkout builds it with `bun run build:whiteboard`. Until it is there, diagrams stay as they are.

### Patch Changes

- @reddb-io/redcode-server@1.18.25
- @reddb-io/redcode-tui@1.21.1

## 0.19.0

### Minor Changes

- d9dcc88: Latency and output speed on the panel

  Every assistant message now records when its first streamed chunk arrived (`time.first`). The TUI footer shows the last reply's latency and its output rate next to context and cost — `1.2s · 84 tk/s` — and the app shows both in the context tooltip and the context tab. Speed counts output plus reasoning tokens from the first chunk to completion; latency is the wait from the request to that first chunk. Messages from before this release show neither rather than a guess.

### Patch Changes

- Updated dependencies [d9dcc88]
  - @reddb-io/redcode-tui@1.21.0
  - @reddb-io/redcode-schema@1.20.1
  - @reddb-io/redcode-sdk@1.19.1
  - @reddb-io/redcode-llm@1.18.21
  - @reddb-io/redcode-protocol@1.18.21
  - @reddb-io/redcode-plugin@1.18.20
  - @reddb-io/redcode-server@1.18.24

## 0.18.0

### Minor Changes

- a4e53f8: Real fan-out: every subtask on a message runs, together; background subagents on by default, capped per session

  A message carrying several subtasks used to run only the last one — the assistant message the first subtask left behind hid the rest. Now all of them run, `experimental.subtask_concurrency` at a time (default 4), and their results land in the order they were asked. Background subagents no longer need `REDCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`; set it to `false` to turn them off. One session may have `experimental.background_subagents_max` (default 4) running at once; past that the task tool refuses and tells the model to wait or run the task inline. Cancelling the run — Ctrl+C, `/goal-drop` — still cancels every child.

- f53faea: `/goal`: a definition of done the harness pursues until it holds

  A goal — free text plus optional `verify:`, `constraints:`, `boundaries:`, `stop when:` and `gate:` lines — lives in the session's metadata and is re-rendered into every turn, so compaction cannot paraphrase it away. At the end of each turn, gates run and a small judge reads the objective against the last answer: CONTINUE is one more turn inside the same run, DONE ends it with the goal met, BLOCKED and the turn budget (default 20) pause it with the reason, WAIT parks it while background work runs. The agent claims completion through `goal_complete` with evidence the judge reads; an unsupported claim comes back as work. Ctrl+C and a new process pause the goal; only `/goal resume` brings it back. Every decision is a row in `redcode debug guards`. Endpoints: `GET/POST /session/:id/goal`, `…/goal/pause|resume|drop|budget`.

- 6c71717: Subagents inherit the goal, and the loop waits for them

  When the parent session has an active goal, every `task` call opens the child's prompt with the objective and the contract — not the budget, not the completion tool: the child does one part, and only the parent's turn is judged. A turn that ends with a background subagent still running parks the loop on WAIT instead of spending a turn; the subagent's report re-enters the parent and the judge runs again on that turn.

### Patch Changes

- Updated dependencies [f53faea]
- Updated dependencies [e2002a5]
  - @reddb-io/redcode-sdk@1.19.0
  - @reddb-io/redcode-tui@1.20.0
  - @reddb-io/redcode-server@1.18.23
  - @reddb-io/redcode-plugin@1.18.19

## 0.17.1

### Patch Changes

- be2fcd5: Build is red, plan is gold, design is cyan — everywhere, including the loading bar

  The brand theme had set primary, secondary and accent all to RedDB reds, and agents took their colour from that palette by position, so every mode looked the same. Each built-in agent now names its colour: build red, plan gold, design a cyan a shade under bright. The TUI's loading scanner takes its head from the agent's own colour instead of the theme accent, so it changes with the mode again. The app gets a design token to match.

- 5416f9d: A message injected without an agent stays in the conversation's agent

  Design feedback from the browser, orphan recovery and plugin-injected prompts name no agent. They used to land on the default agent, which flipped a plan or design session back to build. A prompt without an agent now continues the agent of the last user message; only a session with no history takes the default.

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

- Updated dependencies [be2fcd5]
- Updated dependencies [2e219a9]
  - @reddb-io/redcode-tui@1.19.1
  - @reddb-io/redcode-server@1.18.22

## 0.17.0

### Minor Changes

- 604ce9f: Design mode: craft that is checked

  A prototype that only shows the populated state decides nothing, so `design_preview` now reports which of the five states — loading, empty, error, populated, edge — the prototype does not render, and writes each as a question into `design.json`, where `design_exit` carries it into the plan. `design.json` gains a `kind` (screen, flow, comparison, deck), each with its own checks. The craft notes grow the second set: uppercase without tracking, images loaded from a network the prototype does not have, raw hex outside the token block, the accent used everywhere.

- 7bc774e: Design mode: a note can carry an image, and notes can be held

  In the review window, paste or drop a screenshot or sketch beside what you type; it reaches the agent as a reference for that note, downscaled in the browser and checked by its bytes on the server. A Hold button keeps notes on the page until you press Send, so one message can carry a whole review — nothing accumulates on the server and nothing wakes the agent but Send. The app's Design tab no longer remounts the review surface on every revision, which was throwing held notes away.

- 6c81f67: Design mode: the project's design system, read and handed over

  On entering the `design` agent, redcode reads `DESIGN.md` or `.red/DESIGN.md` from the project and puts it in the mode's prompt. When neither exists it scans the repository — framework and component library from `package.json`, the token block from the stylesheet that declares the most custom properties, fonts, a few styled pages to read, an existing design doc — and writes `.red/DESIGN.md` with what it found, so the summary can be corrected once and believed from then on.

### Patch Changes

- 7363e57: Design mode: the session's end is written down, and a closed session's prototypes stop being served

  When a turn ends, `design.json` records which revision it ended on, so a design reopened later knows where it stopped. When a session is deleted its prototypes stop being reachable — before, nothing ever released them. And `design_preview` says when the review window has not checked in for a while, so the agent knows it may be talking to nobody. Also fixes prototype ids, which were the first sixteen bytes of `session:path` and therefore the same for every prototype on a machine.

## 0.16.0

### Minor Changes

- c5cf65a: Design mode: work out what something should be by building it, then turn that into a plan

  A third mode beside build and plan. The `design` agent writes a prototype into `.redcode/designs/`, opens it with `design_preview`, and the user talks back from either side: alt-click an element in the browser (or the app's new Design tab) and say what should change, or just say it in the chat. Each preview carries craft notes when the prototype reaches for the patterns reviewers recognise as generated. `design.json` beside the prototype keeps the decisions settled and the questions open, and `design_exit` writes the plan from it. Behind `REDCODE_EXPERIMENTAL_DESIGN_MODE`.

### Patch Changes

- Updated dependencies [c5cf65a]
  - @reddb-io/redcode-tui@1.19.0
  - @reddb-io/redcode-server@1.18.21

## 0.15.0

### Minor Changes

- 68c96b4: Write down every time a guard intervenes, so the thresholds can be argued from evidence

  Five guards ship in 0.14.0 — the inactivity watchdog, tool deadlines, the loop guard, the step budget, the bounds on naming and compacting — and every threshold in them was chosen by argument, because there was nothing to measure. Each intervention is now recorded with which guard fired, what it acted on, and what it did, and published as a live `session.next.guard.tripped` event. `redcode debug guards` reads it back: counts per guard and action over the last week, loudest first, plus the most recent trips. An empty report says so in words, because "nothing fired" and "nothing was collected" are different answers.

- 7246ae1: Notice a call that never stops being made, even when the answer keeps changing

  Comparing results is what keeps the loop guard off polling's back, and it was also the way through it: an answer carrying a timestamp, a pid or a temporary path never repeats byte for byte, so the same call could run all turn without ever counting as repetition. At twelve identical calls in a row the repetition is mentioned once — the call still runs, because polling looks exactly like this and is sometimes right. Configurable as `experimental.loop_guard.nudge_at`.

### Patch Changes

- 566eb17: Say when mise is holding a release back, instead of reporting a failed install

  mise refuses to install a release younger than its `minimum_release_age`, and says so only on a line of stderr nobody reads. The update prompt offered a version mise had quietly decided not to see, `mise upgrade` exited 0 having done nothing, and the failure read as "mise did not install vX" — sending the user to run a command that changes nothing. When the version is not even on offer, the message now names the gate and gives the one-line fix that lets Redcode's own releases through while keeping the delay for everything else. The five turn bounds and `redcode debug guards` are now documented too.

- f94e2cb: Close turns left open by a process that died, and stop calling them a queue

  `time.completed` on an assistant message is written by the process running the turn. Killed mid-turn — an OOM, a machine going to sleep — nobody writes it, and the message stays open for the rest of the session's life. The TUI reads an open assistant message as a turn in progress and stamps QUEUED on everything typed after it, across restarts, with nothing running: a session that survived one crash looks jammed forever. A fresh run now closes anything left behind by a run that is gone, records it, and the QUEUED badge requires the session to actually be busy.

- Updated dependencies [68c96b4]
  - @reddb-io/redcode-schema@1.20.0
  - @reddb-io/redcode-server@1.18.20
  - @reddb-io/redcode-tui@1.18.20
  - @reddb-io/redcode-llm@1.18.20
  - @reddb-io/redcode-protocol@1.18.20

## 0.14.0

### Minor Changes

- 78d1b03: Bound the model calls a turn makes that are not the turn itself

  Naming a session and compacting the conversation both call a provider outside the step loop, where the turn's inactivity watchdog cannot see them: one runs before any step handle exists, the other creates a processor of its own. A provider that stopped answering during either held the turn open with nothing on screen and no error. Both now give up — naming after two minutes, compacting after ten — and say so. A session keeping its default name is a far smaller loss than a turn that never starts. Configurable via `experimental.aux_timeout`.

- 82bb18a: Say what a busy session is actually doing

  `session.status` reported `busy` as a bare tag, so the TUI had to reverse-engineer the phase from message parts and every other client got nothing at all. `busy` now carries an optional phase (preparing, thinking, writing, tool, compacting), the tool being run, the step number, and when the phase started. The fields are additive: readers that discriminate on `type` alone are unaffected. The TUI uses them for the window the parts cannot describe — before the first byte arrives — and shows the step number, so a turn on its eighth step no longer looks the same as one that just started.

- 8c43207: Notice when the model is repeating itself, and say so instead of asking the user

  The old detector compared the last three parts of a single assistant message and required byte-identical serialized input, so one interleaved reasoning part — which reasoning models emit constantly — reset it permanently, a loop spanning steps was invisible, and when it did fire it asked a question whose wait had no bound: the only defence against a loop was itself a way to hang. It now looks across the whole turn, counts only calls that returned the same result (identical calls with different results are polling, and are left alone), and answers the repeated call itself with a correction quoting the model's own arguments and the answer it keeps ignoring. If the correction changes nothing, the turn ends. Nobody is asked anything. Configurable via `experimental.loop_guard`; a `doom_loop: "allow"` permission rule still turns it off.

- 071c47d: Stop turns from stalling or looping in silence: a turn now has a hard step ceiling, a stream that goes quiet is aborted whatever content type it uses, auto-compaction can no longer paste your prompt back into the transcript over and over, the TUI re-reads the session after the event stream reconnects instead of waiting on a message it never received, and the status line says when nothing has arrived for a while rather than spinning as if it were working.
- 603d8c7: Ask for a report before the step ceiling instead of cutting the turn off at it

  The turn ceiling was a cliff: at step 200 the turn stopped and everything the model had worked out but not yet written down went with it, leaving the user told to "send another message to continue" with nothing to base it on. The last steps before the wall are now spent the way `agent.steps` already spends its own: tools off, a summary of what was done, what is left, and what to do next. The wall itself is unchanged, for a model that will not yield. Configurable via `experimental.turn_steps`.

- 86b2250: Stop a tool that never returns instead of letting it hold the turn open

  Most tools carry no bound of their own, so a read on a dead mount or an MCP call to a process that went away kept a turn running with no output and no error — and the turn's inactivity watchdog could not help, because a tool in flight is deliberately counted as work. Tool calls now have a ten minute backstop, reported to the model as an ordinary tool failure it can react to. Tools that legitimately take as long as they take are exempt (`shell`, `bash`, `question`, `task`), and time spent waiting on a permission prompt is not charged against the tool. Configurable via `experimental.tool_timeout`, `false` to disable.

- de65b16: End a turn that has stopped producing anything, where nobody is watching to end it themselves. Time a tool spends running or a permission spends awaiting an answer does not count as silence, so a long build is never mistaken for a provider that went away. In the TUI and the desktop app the turn is reported rather than ended, since a person is there to read it and press escape; a scripted run, an editor speaking ACP or a scheduled job ends it. Configurable through `experimental.turn_stall`, or `false` to disable.

### Patch Changes

- 95297f3: Only treat an install as mise-managed when Redcode itself came from mise

  The check matched any `mise/installs` path in the running executable, so a machine whose Bun comes from mise reported every Redcode install as mise-managed — and self-update would then try `mise upgrade` on a tool mise does not have. It now matches Redcode's own install directory.

- Updated dependencies [82bb18a]
  - @reddb-io/redcode-schema@1.19.0
  - @reddb-io/redcode-server@1.18.19
  - @reddb-io/redcode-tui@1.18.19
  - @reddb-io/redcode-llm@1.18.19
  - @reddb-io/redcode-protocol@1.18.19

## 0.13.4

### Patch Changes

- eb82e38: Catch up with upstream fixes we were missing and make a running turn legible: the footer now says what the assistant is doing (thinking, editing a file, running a command) instead of showing a bare spinner; language servers that die because the environment exports a Node flag they refuse are restarted without it; stalled streams, unrecognised gateway errors and `network_error` finishes are retried instead of losing the turn; `gpt-5.x` works through OpenAI-compatible gateways again; a failed subagent reports its failure instead of returning nothing; `redcode run` answers permission requests raised by subagents; config writes stop erasing keys the schema does not model; and the whole workspace's tests now run in CI, not just four packages.

## 0.13.3

### Patch Changes

- 9988bc7: Stop long sessions from growing without bound and being OOM-killed: turn diffs no longer embed a whole copy of every large file they touch, concurrent turn summaries collapse into one run instead of hydrating the session several times over, edit tool metadata carries diagnostics only for the files it touched, and the TUI mirrors a session's messages only once something asks for that session. Also documents installing and upgrading with mise.
- 9988bc7: Cap how many language servers run at once (`REDCODE_LSP_MAX_CLIENTS`, default 8) so a monorepo with per-package linter configs stops spawning one server per package, put a deadline on the npm install that plugin loading holds a cross-process lock across, and trim the whitespace around a typed message so a trailing newline is not part of what you said and a blank input is not sent at all.
- 550623f: Recognize Redcode installs managed by mise (`github:reddb-io/redcode`, the way red-dev installs it) so the update prompt and background auto-update upgrade through mise instead of failing with "Unknown installation method", and show the real reason in the TUI when an update fails.
- 9988bc7: Recover from stuck states without the user having to diagnose them: a worker thread that throws or dies now fails the waiting call instead of freezing the UI, a lock whose owning process is gone is taken over immediately rather than after a minute, startup no longer waits forever on a stalled home directory, a piped stdin that never closes, a hung git, or an unbounded musl probe, and language servers close documents past an open-file cap instead of holding every file the session ever touched.

## 0.13.2

### Patch Changes

- 357a0eb: Reload providers and models live when the models catalog refreshes, so newly published models (for example OpenRouter's GLM-5.3-Flash) show up in `/models` without restarting, and allow the catalog download up to 30 seconds instead of 10.

## 0.13.1

### Patch Changes

- 4fd7ecc: Replace stale upstream product branding, links, assets, and TUI guidance with Redcode equivalents.
- 4fd7ecc: Make `REDCODE_*`, Redcode service identity, and `.redcode` paths canonical while safely adopting persisted legacy configuration and databases.
- 4fd7ecc: Rename the public API and SDK product identity from OpenCode to Redcode.
- 4fd7ecc: Avoid reporting unavailable language servers as failures, reduce duplicate monorepo roots, and surface actionable startup and process-exit errors in LSP status views.
- 4fd7ecc: Improve long-session responsiveness by bounding compacted history reads and coalescing shell progress updates. Keep unfinished todo work active across natural model stops when the todo tool is available.
- 4fd7ecc: Move the TUI Workers view into a switchable Context and Workers session sidebar with keyboard and mouse resizing, and show Redskilled connectivity beside the prompt directory.

## 0.13.0

### Minor Changes

- 0459ebc: Add typed JSON/TOON RPC session reads, opt-in TOON-RPC ACP framing, and a native framed RPC sidecar in every Redcode platform package.

## 0.12.0

### Minor Changes

- 6e41f4b: Add Location-scoped V2 operation hooks with waterfall, serial, and parallel dispatch, deterministic plugin ordering, scoped disposal, and real operation payloads. Migrate agent, command, compaction, permission, text, tool, and turn lifecycle hooks off the EventV2 placeholder dispatch.

## 0.11.1

### Patch Changes

- 68f163c: Remove the experimental global TUI statusline, its configuration, and its plugin extension API.

## 0.11.0

### Minor Changes

- 3f7128c: Add observable start and end lifecycle events around each agent turn.

### Patch Changes

- 0df4500: Run EventV2 serial dispatch listeners sequentially instead of concurrently.
- 3b8372f: Expose V2 compatibility surfaces alongside legacy plugin hooks for agent pre-step and pre-system transforms, tool post-execution, command pre-execution, permission requests, compaction preparation, and completed text. Preserve mutations produced by legacy hooks as the default input for the new waterfall stages.

## 0.10.0

### Minor Changes

- 2861f34: Introduce capability seams for filesystem, shell, subprocess and LSP, plus the V2 plugin-context surface to register additional backends. The harness is now composable per-location without touching core: a plugin can install a remote FS, an SSH-backed shell, or a Docker sandbox and consumers keep talking to the same service tag.
  - `packages/core/src/capability/{filesystem,shell,process}.ts` and `packages/redcode/src/capability/lsp.ts` define `Interface` (consumer surface), `Backend` (provider shape) and a default `Local` backend that wraps the existing implementation.
  - `packages/core/src/capability/registry.ts` exposes `CapabilityRegistry.Service` with per-capability `register(backend): Registration` — plugins install a second backend and `dispose` removes it on scope exit.
  - `packages/core/src/capability/shell/ssh.ts` ships a minimal real SSH shell backend (`ShellService.Backend` over ssh2) as the proof that the seam accepts a second provider.
  - `packages/plugin/src/v2/effect/{capability,context}.ts` exposes `ctx.capability.{filesystem,shell,process}.register` to V2 plugins.
  - `packages/redcode/src/plugin/index.ts` logs a one-line deprecation warning when a V1 plugin loads through the legacy `server()` hook, pointing at the V2 surface.

  The full V1→V2 hook translation shim is intentionally out of scope for this release and lands in the next minor; this PR makes the seams available and signals the migration path.

## 0.9.0

### Minor Changes

- d7114e2: Introduce capability seams for filesystem, shell, subprocess and LSP, plus the V2 plugin-context surface to register additional backends. The harness is now composable per-location without touching core: a plugin can install a remote FS, an SSH-backed shell, or a Docker sandbox and consumers keep talking to the same service tag.
  - `packages/core/src/capability/{filesystem,shell,process}.ts` and `packages/redcode/src/capability/lsp.ts` define `Interface` (consumer surface), `Backend` (provider shape) and a default `Local` backend that wraps the existing implementation.
  - `packages/core/src/capability/registry.ts` exposes `CapabilityRegistry.Service` with per-capability `register(backend): Registration` — plugins install a second backend and `dispose` removes it on scope exit.
  - `packages/core/src/capability/shell/ssh.ts` ships a minimal real SSH shell backend (`ShellService.Backend` over ssh2) as the proof that the seam accepts a second provider.
  - `packages/plugin/src/v2/effect/{capability,context}.ts` exposes `ctx.capability.{filesystem,shell,process}.register` to V2 plugins.
  - `packages/redcode/src/plugin/index.ts` logs a one-line deprecation warning when a V1 plugin loads through the legacy `server()` hook, pointing at the V2 surface.

  The full V1→V2 hook translation shim is intentionally out of scope for this release and lands in the next minor; this PR makes the seams available and signals the migration path.

## 0.8.4

### Patch Changes

- 70164dc: Surface redskilled status more clearly in the Workers tab. Adds a red "✗ N failed" badge in the header for stuck workers, a blinking dot when the daemon is live, idle-state CTAs (`[start drain]` / `[z resize]`) instead of plain text, and a "tracking Xs" indicator driven by a `trackingSince` signal that stamps on the first payload.

## 0.8.3

### Patch Changes

- e10ce05: Fix the ACP default model selection so a configured `model` is honored even when its provider has not finished loading yet. Previously, `defaultModelFromConfig` would skip the configured model when the provider lookup failed and fall back to the built-in `opencode` provider, snapping the footer back to big-pickle whenever sessions switched modes (build → plan → build) or the directory was re-evaluated. The configured model now always wins; any fallback is computed from the connected providers.

## 0.8.2

### Patch Changes

- 7b580fd: Fix the ACP default model selection so a configured `model` is honored even when its provider has not finished loading yet. Previously, `defaultModelFromConfig` would skip the configured model when the provider lookup failed and fall back to the built-in `opencode` provider, snapping the footer back to big-pickle whenever sessions switched modes (build → plan → build) or the directory was re-evaluated. The configured model now always wins; any fallback is computed from the connected providers.

## 0.8.1

### Patch Changes

- ccaf6e3: Stop reading the legacy `~/.config/redcode/` XDG directory. Global config now comes only from `~/.red/redcode/` (`config.jsonc` primary, `redcode.*` / `opencode.*` still merged beneath it). Stale generated files left in the XDG directory — e.g. a `provider.minimax` block pointing at the dead `api.minimax.chat` endpoint — no longer leak into the merged config.
- 9d9ae8e: TUI: the `/connect` API key dialog now shows a busy spinner while the credential is saved and the instance re-bootstraps, and surfaces save failures as a toast. Previously the dialog looked frozen for the duration of the reload (tens of seconds when plugins or provider packages are reinstalled) and every extra `enter` re-submitted the key.

## 0.8.0

### Minor Changes

- 69252bd: Add a responsive two-column sidebar. Narrow terminals and the overlay layout keep the existing single-column surface. Wide terminals gain a Session column for Context, Todo, and modified files, plus a Project column for MCP and LSP, with the title and footer spanning the full sidebar width. The existing `sidebar_content` slot stays compatible; new Project-scoped surfaces register via the `sidebar_project` slot.

### Patch Changes

- c00206b: Move the global config directory from `~/.config/redcode/` to the RedDB family at `~/.red/redcode/` and rename the global config file to `config.jsonc` (with `config.json` as an alias). The XDG directory is still read as a fallback so existing installs keep working without manual migration; the transitional `redcode.json` / `redcode.jsonc` and the legacy `opencode.json` / `opencode.jsonc` names are still read everywhere the primary `config.*` name is, and the primary file always wins on merge.

## 0.7.0

### Minor Changes

- ba92896: Enable native language servers and agent semantic tools by default, and surface language-server initialization failures in status views.
- 813cfe7: Add the RedDB-derived Redcode TUI theme as the default while preserving the legacy OpenCode theme as an explicit option.

### Patch Changes

- af92e75: Finish Redcode branding across terminal surfaces and keep generated session titles focused on user intent instead of unsupported repository findings.

## 0.6.0

### Minor Changes

- 34e796e: Move the RedSkills dashboard and controls onto redskilled's public stdio ACP adapter, route work decisions through generic ACP turns, and remove Redcode-owned consent and control state.

### Patch Changes

- e027128: Reject provider config that sets `npm` when the resolved provider package disagrees, instead of silently dropping the override. A `providers.<id>` block could override the endpoint (through `api.url` or `request.body.baseURL`) while its `npm` key was discarded as an unknown property, so the catalog's SDK was combined with the configured host into an endpoint neither source describes — for example the Anthropic `/v1/messages` path sent to an OpenAI-compatible host. The conflict now fails at config resolution with a message naming the requested package, the resolved package, and the URL the request would have used.

## 0.5.2

### Patch Changes

- 232b6f5: Apply a provider block's `npm` to every model of that provider, not only to models the same block redeclares. A config that set `npm` together with `options.baseURL` but declared no `models` had its `npm` silently ignored while the `baseURL` was applied, so the catalog's SDK was paired with the configured host — for example the Anthropic `/v1/messages` path sent to an OpenAI-compatible host, which 404s. Omitting `npm` still keeps the catalog package while overriding the host, and a per-model `provider.npm` still wins over the provider-level value.
- e8295f1: Show the provider, model and request URL on provider transport failures.

  A failing provider request used to print only the response body, e.g. `404 Page not found`, which cannot be told apart from a wrong API key, a wrong model id, or a wrong host. The request URL was already recorded on the durable message record but never displayed. It is now shown on both the CLI (`redcode run`, interactive and streaming) and the TUI message panel:

  ```
  404 Page not found
    provider minimax/MiniMax-M3
    request  https://api.minimax.chat/v1/messages
    status   404
  ```

  The resolved provider and model are now recorded on the error itself, so `session.error` events and `--format json` carry them too. Request URLs are redacted before display: userinfo, fragments, and all query values outside a small allowlist are withheld, so an API key embedded in a URL cannot leak. Response headers are never displayed.

- ab85ac4: Prefer `redcode.json` / `redcode.jsonc` for global and project configuration, keeping `opencode.json` / `opencode.jsonc` as a fallback.

  The global config directory is already `~/.config/redcode/`, but the file inside it was still OpenCode-named. Both names are now read everywhere, in every scope. Existing configs keep working with no migration and no warning: when a directory holds both names they are merged exactly the way `opencode.json` and `opencode.jsonc` already merge, with the Redcode-named file winning the fields they share. Directory proximity still outranks the file name, so a nested `opencode.json` beats a `redcode.json` further up.

  Files are never created beside an existing config. A global config or an `opencode mcp add` target is only written under the Redcode name when no config exists at all; otherwise the file already on disk is edited in place.

  The `customize-opencode` skill no longer points the agent at `~/.config/opencode/`, which has not been the config directory since the directory rename.

## 0.5.1

### Patch Changes

- be73f63: Report a rejected `opencode run` prompt exactly once. The request's own error and the `session.error` event the server publishes for it are the same failure on two channels, so the run could print it twice — or emit two `error` records on `--format json` stdout — depending on whether the event subscription attached before the server published. The first reporter now wins and the other stays silent.
- 21b52c2: Add `redcode debug runtime`, which prints the composition the current location actually booted: the active Cordis profile and its ordered plugin IDs, the effective service topology derived from the compiled layer graph, and the runtime invariant report from boot readiness. Runtime invariants now return a typed result per owner instead of passing silently, and a failing owner is named while still failing boot. The payload carries identifiers only — no config values, credentials, paths, or environment.

## 0.5.0

### Minor Changes

- 5d89064: Add a governed RedSkills child Agent contract to `redcode acp`, including parent-bound outcomes and permissions, cancellation-safe multi-turn sessions, and authority isolation from GitHub and redskilled.

## 0.4.0

### Minor Changes

- 7b8733f: Rebuild the Workers view as a live fleet console: capacity meters for slots and memory, a sortable-by-project table with phase bars, heartbeat freshness and token counters, and a detail pane with throughput rates, a token sparkline, and a per-Worker activity feed. Adds enter to expand one Worker, o to open its issue, R to refresh, g/G to jump, and a tab badge that counts failed Workers.

### Patch Changes

- 13afa51: Publish a real npm package page: what Redcode is, how to install it, the commands you can run, and attribution to OpenCode and DeepSeek Harness. The tarball now also carries NOTICE alongside LICENSE.
- c5cda51: Identify the native ACP Agent and its terminal authentication flow as Redcode.

## 0.3.2

### Patch Changes

- e66d0ce: Open Redcode directly in a new full TUI session and use Redcode branding in terminal titles.

## 0.3.1

### Patch Changes

- a0279da: Open Redcode directly in the full chat shell, including for profiles that previously selected the legacy interface.

## 0.3.0

### Minor Changes

- e5c97af: Boot internal plugins through the transactional Cordis profile host and expose an inspectable Location service graph.

## 0.2.0

### Minor Changes

- 32afa3a: Open RedCode directly in a full chat draft, apply the RedCode wordmark and brand palette, and add transactional plugin profile composition with runtime inventory checks.

### Patch Changes

- 1b06d4e: Publish checksums with every native archive and refuse to replace assets on an already published Redcode tag.
- 4a44912: Make npm release reconciliation tolerate registry propagation delays before publishing the GitHub Release.
- 38d25c3: Make Redcode releases recoverable by tag and publish native packages with verifiable repository provenance.
