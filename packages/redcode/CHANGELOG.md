# @reddb-io/redcode

## 0.61.0

### Minor Changes

- Restore the Design surfaces in the web and desktop app: a Design tab lists the session's designs with their review state, revision, approval and design system, opens the browser review, and comes forward once when the agent publishes a new preview. Browser review feedback shows as a compact card with the message, numbered notes and attachments, and an approved Design marks the transcript.

  Show System One response review notes in the app transcript, including answers revised after S1 review, add the RedRouter model suggestion card with switch and keep above the composer, and show the effective S1/S2 roles and their origin in the model settings. The new app strings ship in English and Brazilian Portuguese.

- Restore the V1 compaction controls on the V2 runtime. `/compact <focus>` steers the summary in the TUI and the web app: the focus travels with the compaction request (`focus` on `POST /api/session/:sessionID/compact`) and the summary gives it the most detail. A later `/compact` that joins a pending one keeps the first focus, and requests queued before this release still run.

  The recent history kept verbatim beside a summary now scales with the window: a tenth of the usable context, between 8k and 60k tokens and never more than a quarter of a small window, instead of a fixed 15k (`compaction.keep.tokens` still sets it exactly). A huge pasted request no longer rides every later request whole: once it exceeds its share it is kept as a head and tail around a `[middle elided: N tokens]` marker, and when the provider refuses a summary request whose newest exchange alone is too large, that exchange is sent the same way instead of failing the compaction.

  When less than 5% of the context is left and automatic compaction is off or paused, the model gets one chronological reminder to finish the current step and hand off cleanly; it drops out once a compaction frees room.

  Add `compaction.background` (off by default): shortly before the threshold, the summary is prepared beside the running step and committed at the next step boundary that needs it, as long as the history it covers is unchanged. Preparation never writes a checkpoint, is cancelled when the session goes idle, and its usage is billed as compaction.

- Restore the full Design mode instructions on the V2 runtime: targets (web, app and presentation) and their viewports, the design-system contract with `.red/DESIGN.md`, variants and variant operations, screens, params, stable `data-design-id` markers, the feedback-round verify protocol, the two-cycle quality loop and todo evidence. Design mode again edits only the prototype and never replaces product code with prototype markup.

  Plan and Build receive the approved Design requirements, selected variant, target product files and implementation contract as Session context again, so they survive resume and compaction instead of living only in the approval message. With dual reasoning, a Design turn or a request System One routes as design starts identifying the design system in the background, so creating a design no longer waits for it. Add `design_history` to list a design's revisions and restore an older one as a new revision.

- Restore the Design review cards in the TUI on the V2 runtime: browser feedback shows as a compact card (target, revision, variant, operation, numbered notes, attachments) instead of the full `<design-review>` message, an approval shows the approved variant with a link back to the review, and a created design shows its target and design-system chip with the identification line, also when tool details are hidden. Add a storybook story for the cards.

  Open the browser review at most once per review again. The server counts connected review pages and grants one launch per 15 seconds, so `/review`, `/design-review` and a newly published revision open no duplicate tab; a publish opens the review only when no page follows the session, a failed launch gives its claim back, and an already open review is reported instead of opened. `REDCODE_NO_BROWSER` still prevents every launch and shows the link. In app mode, review and presenter links to redcode's own server now redirect to the design app, through a waiting page with download progress while the app downloads or starts, and the TUI shows the first download's progress as a toast. `redcode design --target web|app|presentation [--platform ios|android]` skips target detection again, running the session on a private server that receives the forced target.

- Restore Redcode observability on the V2 engine. The TUI Context sidebar and the app's context tooltip show the latest step's latency and output speed. Latency runs from the request to the first text, reasoning or tool input; speed counts tokens between the first output and the end of the response, so tool runs never count, and when the provider reports reasoning that did not stream, only the visible output is rated. Nothing is shown when there are too few tokens or too short a window to mean anything. Assistant messages gain `time.first`.

  The running prompt footer says what the assistant is doing (waiting for the model, thinking, responding, running a tool) and which step a long run is on, says plainly when nothing has arrived for 90 seconds, and shows the latest stall or loop guard warning of the run.

  A failed provider request names its provider, model and request URL, with credentials, query string and fragment removed, in the TUI, in `redcode run` and in the log. An unexpected server error answers with a 500 whose body carries the cause's first line, an `err_xxxxxxxx` reference logged next to the full cause, and the log file to read.

  Add a global `--verbose` flag (also `REDCODE_VERBOSE=1`) that traces the boot phases to stderr until the TUI takes the terminal, writes the trace to the log, and logs activity at debug level. `redcode debug startup` prints the same phases, and `redcode debug memory` reports this process's heap and resident memory, the background service's resident memory, the database size and session counts.

- One `/goal` command replaces the five goal entries in the TUI slash menu. `/goal <objective>` sets a goal, `/goal pause|resume|drop|status` and `/goal budget $5` (or `5$`, `200k tokens`, `40 turns`) control it, and `/goal` alone shows the goal's status with the actions that apply. A goal budget in turns sets its step budget: `40 turns` lets the goal use 40 model steps. In dual reasoning, other text is read by System One in any language ("pausa isso por enquanto"), and the TUI asks when the reading is unsure, never dropping or replacing a goal below 85% confidence without confirmation. Without System One the text becomes the goal when none is unfinished, and the TUI asks otherwise. `/goal-pause`, `/goal-resume`, `/goal-drop` and `/goal-budget` keep working when typed, hidden from the menu. The new `POST /api/experimental/session/:sessionID/goal/command` reads a `/goal` text without acting on it.
- Restore the /goal loop on the V2 runtime: an active goal continues through a durable synthetic prompt after the agent stops, until goal_complete verifies it or it is blocked, paused, out of budget, interrupted or stops making progress. With dual reasoning, System One judges each stop as progressing, stalled or blocked and never completes a goal itself. Subagents receive the parent's goal, and the parent waits while background subagents run.

  Restore per-prompt System One classification with bounded session context. It feeds the Design target, task priority and a skill shortlist, and never blocks a prompt. With dual reasoning, System One also reviews the final response: an established issue gets one repair pass, and an unresolved or unavailable review leaves a visible note instead of approving the answer silently.

- End the turn at once when a rate limit or quota resets more than two minutes away, with a message naming the provider, model, and local reset time (`quota exhausted until …; switch model with /model or wait`), instead of waiting up to fifteen minutes. The reset is read from Retry-After, the router's retry-at header, or an "until <time>" in the error. Selecting another model while a retry wait is pending ends the wait and continues with the new model on fresh attempts.

  Restore the `/connect` wizard for any OpenAI-compatible endpoint: base URL, provider ID, display name, Chat Completions or Responses API, optional model IDs, extra headers, and context and output limits. Connecting checks the key and URL against the endpoint's `/models`, discovers its models, writes the provider to the global configuration, and keeps the key in the credential store.

- Restore self-update for mise installs of `github:reddb-io/redcode`: `redcode upgrade` and automatic updates move the mise pin, confirm the new version is the active one, and explain when mise's `minimum_release_age` holds a release back. Honor every `REDCODE_*` environment variable as an alias of its `OPENCODE_*` name, and load `config.jsonc`, `config.json` and `redcode.json(c)` from `~/.red/code` again, above `opencode.json(c)`.
- Restore RedRouter cooperation on the V2 engine. Requests tell a detected RedRouter what it advertised it reads: the `x-red-router-hint` for combos that pick their member per request, the reasoning header (a person's own variant is never overridden), and the token saver and decision layer turned off where the prompt must stay whole. Responses report the model that served each step and its cost, which the step's spend now counts, and a new catalog version refreshes the router's models at once.

  Models whose router accepts automatic reasoning offer an `auto` variant first, which leaves the effort to RedRouter's reasoning autopilot. Flat model ids carry their offers, and every offer with a pin id can be selected as its own model with its provider, route, price, limits and thinking levels. Combos plan for their strictest member when they state no parameters of their own, and never ask for a forced tool choice that any member refuses.

  The RedRouter key's role and MCP server are read on each catalog refresh and saved on the provider, and the key's MCP server is registered automatically (a server you configure under the same name wins). Its key-management tools (creating or listing API keys, reading another key's usage) always ask, can only be allowed once, and are never approved by permission rules, saved approvals, auto-accept or `--yolo`.

- Restore RedRouter model suggestions on the V2 engine. When the router's `recommend_models` tool offers a usable model of the same connection (vision the current model lacks, a larger context, a much cheaper equivalent), the session records it and the TUI shows a compact card above the prompt with the reason and the price, context and capability deltas. `/switch-model` selects the suggested model for the session, `/keep-model` dismisses it and stops that kind of suggestion for the session; nothing switches until you accept. Turn suggestions off with `experimental.model_suggestions: false`.
- Restore the V1 repository guard on the V2 shell tool. `git reset`, `stash`, `clean`, `restore`, `checkout`, `read-tree`, `checkout-index` and `update-ref`, forced or deleting pushes, branch deletion, discarding switches, worktree removal, `reflog expire`, Git directory overrides and a recursive `rm` of the repository or one of its parents are refused before any prompt, with a message saying nothing ran and what to do instead. The guard reads the parsed command words (quotes, paths such as `/usr/bin/git`, `sudo` and `bash -c` scripts included), never prose, and a permission rule you write for the command, such as `{ "action": "shell", "resource": "git stash *", "effect": "allow" }`, lifts it; a wildcard default does not.

  Interrupted tool calls tell the model what it needs to know. A call cut off by a cancel, a stall or a dead process now reads "its outcome is unknown: it may not have run, or it may have partly run. Check the current state before repeating it" (a read-only tool says nothing changed), a stopped foreground shell command carries up to 2,000 characters of what it printed, and the next message you send carries one reminder to check state before repeating side effects. Truncated tool output whose full copy cannot be saved (a full disk, an unwritable data directory) now returns the bounded preview with a notice instead of failing the tool call.

  The TUI folds consecutive failed `todowrite` calls, across assistant messages, into one "Todo update failed ×N" row with the latest refusal; clicking it lists every refusal, and a single failure fixed on the next call is hidden. Question, permission and plan approval dialogs no longer freeze: an answer the server has not confirmed after 10 s (30 s for a remote server) shows a notice and re-reads the pending requests, so a request the server no longer has closes its dialog, and dismissing twice within 5 s (Ctrl+C or Esc) closes it locally. Other errors keep the dialog open with the message.

  Session budgets can come from the configuration: `session.budget` (`max_cost_usd`, `max_tokens`) in the global or project config applies to every session without a budget of its own. `redcode run --max-cost 2.50` and `--max-tokens 500k` set the session's budget for the run, and `redcode run` exits 1 when a budget stopped it. Nothing is limited unless you set a limit, and the model never sets one.

  The models catalog keeps working on networks that block the public endpoints: `REDCODE_MODELS_URL`, then the global `models.sources` list, then `https://models.opencode.ai/api.json` and `https://models.dev/api.json` are tried in order, each with a 30 s timeout. A source that answers 401, 403, 407 or 451, fails with a proxy or TLS error, or returns a page that is not a catalog is skipped for 1h, then 6h, then 24h; the backoff is persisted, the source logs one warning, and a block page never replaces a good cache.

- Keep several TUIs, `serve`, `run` workers and the design app working on one shared database: write transactions take the write lock as they begin and retry whole with jittered backoff when another process holds it, migrations run under the write lock, the WAL switch tolerates a concurrent opener, and a failed statement names its kind and SQLite code.

  Turn Code Mode off by default and advertise tools directly again. Set `experimental.code_mode.enabled` to `"on"` to call tools through `execute`, with each program limited to 50 tool calls, 120 seconds not counting permission prompts, and 1 MB of output (`max_tool_calls`, `timeout_ms`, `max_output_bytes`).

- Restore Enter-steers and Alt+Enter-queues on the V2 engine. While the agent works, Enter steers: your prompt reaches the agent at its next step. Alt+Enter (`prompt.queue`, in every encoding: kitty `CSI 13;3u`, modifyOtherKeys `CSI 27;3;13~`, and `ESC CR` once the terminal has reported Shift+Enter on its own) or the new `/queue <text>` command queues it for after the turn instead; `<leader>return` still queues too. When the session is idle, Enter and Alt+Enter both just send. With an empty prompt, Enter steers the most recently queued prompt. The busy hint reads `enter steer · alt+enter queue`, or names `/queue` where Alt+Enter may not arrive. Mini follows the same keys and `/queue`. In the web app Enter steers, and Alt+Enter (like Mod+Enter) or `/queue <text>` queues; the submit hint now shows Alt+Enter.

  The new `prompt.steer` keybind is unbound by default; a config that still sets `"input_steer": "alt+return"` keeps Alt+Enter steering, and V1 `input_queue` and `input_steer` settings migrate to `prompt.queue` and `prompt.steer`. `redcode run`, ACP and SDK callers are unchanged: a prompt without a delivery still steers.

- Restore subagent supervision on the V2 engine. The subagent tool takes `scope`, `done_criteria` and `return_format` and hands them to the subagent after its prompt. With dual reasoning, System One reviews the brief before the subagent starts: a brief that needs revision fails the call with the issues and the questions to answer, and a second rejection for the same request lets it start with a warning. An unavailable System One never approves silently, and single reasoning checks the structure only. When the brief has structure, the result is checked against it (empty result, criteria never mentioned, no successful change, files changed outside the scope, failing verification commands), then by System One in dual reasoning, with one repair round in the same subagent. The verdict (verified, needs revision, inconclusive or unverified) is appended to the result the parent reads, kept on the task part and in the child session's metadata, and a result the stop-loss cut short is handed back as incomplete.

  Cap subagent fan-out in code with `experimental.subagent_limits.concurrent` (foreground subagents in flight per session, default 4), `experimental.subagent_limits.per_request` (new subagents per user message, default 12), `experimental.background_subagents_max` (default 4) and `experimental.subtask_concurrency` (foreground subagents running at once, default 4); a call over a cap fails with the reason and what to do instead.

  Subagent task rows in the TUI and task cards in the app show a verdict badge (✓ verified, ? inconclusive, ! needs revision, ~ unverified) and where the stop-loss left the subagent. Inside a subagent the TUI shows the brief it was launched under, collapsed to its goal until clicked, and its checkpoint history.

- Session worktrees can live in the temporary directory again. Pass `--tmp` to `redcode`, `redcode run` or `redcode serve`, set `REDCODE_WORKTREE_LOCATION=tmp` (or `repo`), or set `"worktree": { "location": "tmp" }` in the config, and the worktree prepared when Build starts goes to `<tmpdir>/redcode-worktrees/<repository>-<hash>/<name>`, created with `git worktree add` from the repository on a branch of the same `<name>`, and `.git/info/exclude` is left alone. The flag and the environment variable override the config; with the background service they apply to the Sessions started from that terminal only. `worktree.tmpdir` replaces the system temporary directory. The worktree and its branch are named after the Session title or its first prompt (`fix-login-redirect`, then `fix-login-redirect-2`) instead of `redcode-<hash>`, and a toast names the worktree the Session moves into, with `temporary worktree <path>` for a temporary one. `redcode worktrees list` marks temporary worktrees `tmp`, and so does `/worktrees`. `redcode worktrees clean` removes the merged or stale ones with the rest, prunes those whose directory is gone, and never removes a worktree with uncommitted changes. `--yolo` sessions get the same worktree: YOLO only skips permission prompts. A repository with no commits yet keeps the Session in its directory instead of failing the prompt, and `worktree.auto: false` or `REDCODE_AUTO_WORKTREE=0` still turn automatic worktrees off.

### Patch Changes

- Compact the S2/S1 model line in the TUI prompt footer: `Gemini 3.7 Flash·high ⁄ JEV 1.13` instead of `S2 Gemini 3.7 Flash · high ⁄ S1 JEV 1.13 RedRouter » Antigravity · RedRouter`. The variant sits right on the S2 model in the accent color, a discreet `⁄` separates the S1 evaluator (or a clickable "S1 setup" hint when it is not configured yet), and the route chain (`RedRouter»Antigravity · RedRouter`) moves to a dim, right-aligned hint shown only when the terminal has spare width. On narrow terminals the route hint disappears first, then the S1 name truncates; the S2 model name is never shortened for width.

  Show what a RedRouter key may do again: the TUI's `/connect` and `/setup` say "standard key" or "admin key", and so do the web app's provider settings. The retry status now names the model it waits for and, for a quota, when it resets: `Retrying in 42s · Gemini 3.7 Flash quota exhausted until 14:05 · attempt 2 · …`.

- Never send a forced tool choice to models that refuse one (Claude Opus 5.5 and later, Fable, Mythos, or a RedRouter model whose parameters say so): requests ask for the tool through `auto`, and structured output asks for the JSON object, validates it against the schema and repairs it once. Classify the `too_many_tokens`, `input_too_long`, `prompt_too_long`, `max_prompt_tokens_exceeded`, `max_context_length_exceeded` and `context_window_exceeded` codes, including ones a router forwards in its error body, as context overflow on 400, 413 and 422, so the session compacts and learns the provider's real limit. Keep output tokens when an OpenAI-compatible server counts reasoning apart from the completion, so cost, budgets and compaction see all of them. RedRouter and 9Router discovery now read `max_input_tokens`, OpenRouter's `top_provider` limits and the models catalog, and give a model nobody describes a 128K context held back by 10% instead of 8K.
- Stop the stop-loss from interrupting productive work. Different edits, task updates and commands that print nothing return the same acknowledgement whatever they did, so a run of them is no longer a repeated result; the same call with the same arguments, failures that repeat and read-only checks that keep answering the same still are. Spend counts only the new context a step read uncached, measured against the largest context earlier in the turn, so a provider that reports its cache differently between steps or a step without usage no longer looks like hundreds of thousands of new tokens, and token spend needs the steps to have cost at least $0.10 when they report a cost.

  System One's checkpoint answers are read one by one on how far the chosen answer leads the next, so an unsure state no longer discards a sure decision. System One continues a session it reads as progressing and ends a turn only on a sure stop or question backed by a stop-loss signal and a state that is not progress; otherwise it can only steer. An unsure System One falls back to the same rules as single reasoning, and those checkpoints are labelled `Stop-loss` instead of `Stop-loss (unverified)`. Task quality reviews accept a task that System One reads as more likely sound, instead of noting every question it answered above 0.1.

- Restore Ctrl+Shift+V as a paste key alongside Ctrl+V for text and images, and insert the clipboard once when a terminal both forwards the key and performs its own bracketed paste. Keep single-line pastes visible up to 250 characters before folding them. A bare Ctrl+C or Ctrl+D on an empty prompt now asks to be pressed again within two seconds before the TUI exits.

  `REDCODE_NO_BROWSER` stops every browser and system-opener launch and shows the link to open instead. Design review links honor `design.browser` and `REDCODE_DESIGN_BROWSER`. Hooks and commands whose process exits without reading its input no longer crash Redcode with EPIPE. A lock left by a process that is no longer running on this host is taken over at once instead of after the stale timeout, and Windows lock contention is retried instead of failing.

- Keep the active session directory, Git worktree, and branch visible in the main TUI, including while Build runs and after the session moves to its worktree.
- `"worktree": { "location": "tmp" }` now also places the worktrees created from `/worktrees` or `redcode worktrees create` under `<tmpdir>/redcode-worktrees/<repository>-<hash>/`, as it already did for the worktree prepared when Build starts; a server started with `--tmp` or `REDCODE_WORKTREE_LOCATION=tmp` does the same. A new session worktree takes the next free directory name from the worktree service, and its branch keeps that name unless a branch of that name already exists.

## 0.60.1

### Patch Changes

- Restore the session's project directory, Git worktree, and branch in the TUI sidebar. Prepare a dedicated Git worktree when Build starts, before the first prompt or continued model step, while preserving changes in the original checkout.

## 0.60.0

### Minor Changes

- Add an MCPs tab to the session drawer with server status, tool discovery, and runtime controls to add, connect, disconnect, and unload servers.

### Patch Changes

- Honor RedRouter and 9Router model parameters for context and output limits, modalities, tool support, and advertised reasoning levels. Keep native provider parameters on their existing provider adapters and avoid sending tools to models whose catalog forbids them.
- Add Alt+1 through Alt+0 to select open session tabs directly, and keep Ctrl+Tab and Ctrl+Shift+Tab for cycling tabs without Zellij shortcut conflicts.
- Restore the separate System Two transformations model in setup and summary compaction, allow a configurable compaction summary output limit, and simplify S1/S2 setup with a shortcut for saved roles and provider-first model selection. Reconnect 9Router with endpoint and model discovery, and show Redcode branding on OAuth callback pages.

  Restore readable S1/S2 model names and route labels in the prompt, model picker, setup, and intelligence status. Preserve router catalog owners, aliases, and exact model IDs while enriching missing names from the bundled models.dev catalog.

## 0.59.5

### Patch Changes

- Preserve conversation history when a V2 compaction checkpoint is incomplete or fails to reduce context. Accept a complete checkpoint when the provider stops at its output limit. Carry bounded user and file anchors across summaries and pause automatic compaction after repeated ineffective checkpoints, with the pause stored in session metadata.
- Restore Redcode project hooks on the V2 runtime: configuration, trust fingerprints, explicit Claude hook import and the /hooks dialog. Reconnect prompt admission, tool execution, permissions, compaction, message and session lifecycle, and subagent hooks while preserving trust invalidation and bounded command output.
- Use the saved RedRouter endpoint for both System One and System Two. Complete System One model setup in the CLI and show the effective S1/S2 selections and their origins in the TUI.
- Restore the Redcode experience on the V2 engine: open real blank sessions at startup and through /new and /clear, restore the Redcode default theme and stable built-in agent colors, and keep Context, Workers and Subagents visible in the session workspace.

  Restore the persisted task sidebar through the V2 session API and preserve the existing Goal slash commands.

  Restore session modified files and language-server status in the sidebar, and reconnect /monitors to authenticated V2 list, inspect and cancellation APIs with session isolation and bounded evidence.

  Keep the modified-files sidebar cumulative across the full session instead of displaying only the latest interaction.

- Restore Redcode's sidebar widths from v0.57.0 and keyboard resizing on the V2 TUI. Keep Context in the right sidebar and move Workers and Subagents into the bottom activity drawer, sharing worker status with the full management page.

  Preserve the empty Context summary and separate project/worktree/branch lines, with text fitted to the sidebar width. Keep legacy sidebar keybinding names; leader+w opens the activity drawer and leader+Shift+w closes a V2 session tab.

  Restore the Todo title, bracketed task markers and status colors, the original section order, and collapse controls only for lists with more than two entries.

  Restore subagent model details and open/steer/kill controls using V2 prompt admission and interruption, including confirmation before stopping a child.

  Restore /context, /subagents, /thinking and /timestamps. Keep /thinking as the display toggle; model effort remains available through /variants and /effort.

  Preserve the historical red scrollbar and informational colors in both light and dark Redcode themes.

  Restore `/pending` over the V2 durable inbox, including queued and steering prompts, timestamps, attachment counts, send-now, discard, discard-all and an explicit empty state. Keep the pending management panel available in direct mode even when the queue is empty.

  Restore `/budget` and Goal cost/token budgets on the V2 runtime. Enforce session, parent-session and Goal limits before each model step, count descendant usage, and show configured limits in the Context sidebar.

  Restore the RedRouter connection endpoint prompt and persist the selected API URL with its credential while continuing to read pre-migration connection metadata.

  Show RedRouter as the first connection option in the Popular group.

  Restore the Redcode session epilogue and clearly show whether Redskilled is on or off in the Workers drawer.

  Remove remaining upstream product branding from Redcode's visible TUI and CLI messages, links, window titles and crash reporting.

- Consolidate validation and releases into one independent Redcode workflow. Keep Linux and Windows product contracts and service startup checks, with Changesets SemVer versioning, npm publication and GitHub releases from main.
- Show a compact Redskilled status beside Server in the TUI's bottom bar. Keep the Workers drawer concise and make connection details available on demand.

## 0.59.4

### Patch Changes

- Wait for plugin activation before listing agents from a newly started server, so `agent list` and `debug agents` include Redcode's built-in and configured agents on their first request.

## 0.59.3

### Patch Changes

- Restore Redcode's S1/S2 setup and evaluation history, Design conversation commands,
  and voice dictation into the composer after the OpenCode V2 migration. Preserve
  Redcode branding and the `/mcp` shortcut. Remove inherited upstream automations
  from the active CI/CD workflow set.
