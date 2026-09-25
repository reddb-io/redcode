# opencode

## 0.54.4

### Patch Changes

- c184dcf: Choosing the System One evaluator in `/setup` now lists every S1 model you can use right away, so you no longer type a model name. The list shows each model your RedRouter serves as `RedRouter · <upstream> · <model>` with its full routed id (the router's recommendation first), then S1 offers from directly connected providers (OpenRouter, Cloudflare AI Gateway, Vercel, Vivgrid, NanoGPT, TypeSafe), then OpenCode Zen's free Jev. Picking one sets the connection, address, credential and model together. "Enter model manually…" is the last option and leads through connection, address, key and model id. If the RedRouter's model list can't be read, the picker says why (rejected credential, HTTP status, unreachable address) and offers Retry instead of dropping you into a blank model prompt. A RedRouter connected under a custom provider id now works as an S1 connection. S1 labels use the same `Provider · Model` format as S2.

## 0.54.3

### Patch Changes

- a4907f4: Design's review page no longer shows a blank white box while a revision loads. The preview area keeps the theme background and a skeleton of the target (slide strip and 16:9 canvas, phone frame, or page) with the current stage and its elapsed time — waiting for the build, preparing the design tools on first use, building, loading assets and fonts, starting the preview — and fades the frame in once its runtime is ready. Before the first revision it says the agent is preparing it and shows what the agent is doing; a failed build shows its summary with Retry. The presenter windows wait the same way. The first download of the design app shows its progress in the TUI, and a review link opened meanwhile shows a page that follows the download instead of a connection error.

## 0.54.2

### Patch Changes

- 353ff38: Plan approval no longer gets stuck in Plan when S1 disagrees. The S1 plan review is now advisory: `plan_exit` always asks "Execute plan …?", shows the S1 verdict with the reason behind each flagged check, and the user's Yes reaches Build whatever the verdict. When S1 flags the same checks across revisions, the result tells the model the user decides instead of asking it to resubmit. Long sessions no longer fail the review by construction: it reads the first and most recent requests within its budget, and truncated evidence no longer counts as a plan gap.

## 0.54.1

### Patch Changes

- 00e4cda: Fix presentation windows ping-ponging between slides forever. Pressing back on the first slide could start the audience and presenter windows echoing each other's moves, flipping the URL between two slides without end, and a reopened window joined the loop. A window now follows its slide frame only for a move the reader made inside it, never for the frame's report of a command; it applies a move from another window only when that move is newer than the one on screen, and never passes on what it received; a new window takes the running show's slide. Previous on the first slide and next on the last do nothing anywhere. If moves still arrive faster than any person could make them, the window pauses sync and says "Sync paused — press a key to resume".
- 9179143: Show an answer revised after System One's review as one reply in the TUI: the final answer and its thought come first, followed by a muted "↻ revised after S1 review (issue) · show original" note that opens the superseded answer on demand. The S1 marker in the prompt footer now warns only when S1 is not set up, unavailable or failing, or left an issue unresolved after its repair, and the S1 dialog says why. System One's `unsupported` check now targets claims of performed or verified work, so greetings and statements of readiness are no longer flagged.
- a73600c: Stop failing todo updates with "Task sources changed during evaluation" whenever another tool call in the same step settles while System One reviews the update. Only a task update committed meanwhile, or a new edit that makes the completion's evidence stale, now refuses it, with the specific stale-evidence message. A completion that cites a callID no tool result has is resolved from the files, design ids and `commands` its explanation names, under the same stale-evidence rules; nothing named still refuses it.
- a514686: Design review: each variant tab now shows a small "×" to delete it (shown on hover/focus of the active tab, always visible on touch/narrow widths, or via the Delete key on a focused tab), opening the same delete confirmation as the variant-actions menu. The variant-actions button's pencil icon is replaced with a clearer "more" icon plus a visible "Variant actions" label, so the Rename/Split/Delete/Move/Merge menu is easier to find.

## 0.54.0

### Minor Changes

- 756b260: Design settles its target and design system faster. In dual reasoning, the per-message classification now also reads the design target (web, app with its platform, or presentation) when it routes a request to design, so creating the design makes no separate `design_target` call. Design-system identification starts in the background as soon as the design agent runs or a message is routed to design. When System One is at least 85% sure and agrees with the design agent (target), or with the file scan (design system), nothing is asked: the design shows a compact chip such as "iOS app · DS: shadcn/ui (packages/ui)", and you can change it with `design_document` update or refresh. The last target you settled in a project is preselected for its next design.
- 433644f: Design now identifies the project's design system as the first step of a new design when `design.system` is not configured, or when its configured paths no longer exist. A bounded, read-only evidence pack (pruned folder tree, stylesheets with tokens, Tailwind/token/theme files, component directories, Storybook and DESIGN.md) lets System One confirm, correct or reject the heuristic scan in dual reasoning (new `design_system_detect` operation); in single reasoning the design agent reads the pack from `design_document` detect and reports its conclusion on create, with no System One call. The adoption question shows a one-line result such as "Design system: Tailwind theme (shadcn/ui) at src/components/ui, src/app/globals.css (90%, System One)" with the reason, and results are cached per project until the scanned files change.

## 0.53.0

### Minor Changes

- f3fbe39: Design now always runs in the design app. Installed redcode no longer carries Design's renderer, exports, raster worker, whiteboard or review and presenter pages: the first time Design needs them, redcode downloads `redcode-design` for its platform from the `design-vX.Y.Z` GitHub release, checks the release speaks its protocol, verifies the archive against the release's SHA256SUMS (a mismatch is refused), and installs it into the cache directory, where later runs reuse it. `design.app.version` picks the release: the one redcode was built with by default, an exact version, or `"latest"` for the newest release that speaks redcode's protocol (offline, the newest compatible release already installed). `REDCODE_DESIGN_BIN` still overrides the binary and a source checkout still runs the app from source. Offline with nothing installed, Design tools fail with a clear error instead of running inline; `design.app.mode` now only applies when redcode runs from source. Review and presenter links to redcode's own server redirect to the app.

## 0.52.0

### Minor Changes

- ffcc9c3: A subagent can run on a model the user asks for. The task tool takes `model` ("providerID/modelID") and `variant`; an explicit model wins over the agent's configured model, which wins over the parent's. An unknown model or a variant the model does not have fails the call with the closest matches, and a variant carried over from the parent or the agent is dropped where the subagent's model lacks it. A new `models` tool, available wherever the task tool is, searches the connected providers' models by words, provider and capabilities (reasoning, tool calls, attachments), your own provider first and newest per family, with limits, variants and known prices, a page at a time; System One evaluator and deprecated models are never listed or accepted. With dual reasoning, System One's brief review flags a model or variant the user did not ask for. The task part records the resolved `model`, `variant` and `modelSource` (explicit, agent or parent), and the child session starts on that model.
- 0369ddb: Subagents are easier to follow and control. A task row in the TUI and the task card on the web now show the model and variant the subagent ran on, a badge for the verdict on its result (✓ verified, ? inconclusive, ! needs revision, ~ unverified) and where the stop-loss left it: in scope, corrected (hint sent) or stopped with the reason. Inside a subagent the footer shows the brief it was launched under (goal, scope, done criteria and return format, collapsed to the goal until clicked) and its checkpoint history. A new Subagents tab in the sidebar (`/subagents`) lists the session's children with their status, model and verdict, and opens one, sends it a steer, or kills it while it runs. When a guard intervenes (the loop guard, the stop-loss, the step limit and the others), the session shows one collapsed line for the trip that expands to its detail. Stop-loss checkpoints are now also kept on the session's metadata so these surfaces can show them without loading the subagent's messages.
- 925b577: The V2 session runtime can now run subagents. Its `task` tool starts a child session in the parent's location, keeps the parent's permission denies, and runs the child on its own runner until it finishes. The brief is reviewed before launch and the result after it, with one repair round, as in the legacy runtime. A child the stop-loss stops reports why. The `models` tool is also available in V2, and `SubagentStart` and `SubagentStop` hooks now run.

### Patch Changes

- ed836ba: Regenerate the legacy JavaScript SDK from the server's HttpApi. Adds design, intelligence, and RedRouter-connect client methods that had drifted out of sync with hand-edited generated files, and drops a few unused response types (`RouterUpstream`, `RouterVariant`, `RouterConnection`, `ForbiddenError`) that no route referenced anymore.
- 1d03e74: Removing a provider now sticks. A provider that the environment would load again (for example through `ANTHROPIC_API_KEY`) is hidden through `disabled_providers`, and the removal says which variables would have brought it back; connecting it again shows it. Hidden providers stay in the connect list so they can be connected again.

  OpenCode Zen and Amazon Bedrock are now opt-in. OpenCode Zen loads only with an API key (environment, saved or configured) or a `provider.opencode` entry in the configuration, and no longer appears on its own with the public key. System One's "OpenCode Zen — Jev Free" transport is unchanged. Amazon Bedrock no longer loads just because AWS credentials are present in the environment or `~/.aws`: connect it to import an AWS profile (including SSO profiles) or the AWS credentials in the environment, with a region, or to save a Bedrock API key. A `provider.amazon-bedrock` configuration entry keeps working as before.

- f97bfd4: Stop the agent from answering itself after a simple reply in dual reasoning. System One's response review now repairs only issues it establishes with high confidence, repairs each issue at most once, and stops when the revision changes nothing material. Checks that need tool results, tasks or an active goal are no longer asked without them, and a plain answer turn with none of them is not reviewed. In the TUI, a revised answer collapses into its revision with a short "revised after S1 review" line.
- 4b2b56e: Fix the setup dialog showing a raw router alias id (e.g. `ocg/glm-5.3-flash`) instead of the model's display name when a saved System Two principal or fast model was saved under an id a router later renamed. The "Continue with…" label now resolves router aliases before reading the model's name, and both the System Two and System One "Continue with…"/summary labels use a consistent `Provider · Model` format.

## 0.51.0

### Minor Changes

- 7286ed2: A stop-loss watches every turn for work that keeps spending without progress: steps that change no file, complete no task and bring back nothing new, the same result or error coming back, repeated task failures, and the tokens and time spent since the last progress. In dual reasoning System One checks the trajectory against the request on those signals and every 8 steps, and decides whether to continue, steer the model with a hint (at most two a turn), end the turn with a specific question for the user when the work waits on them, or stop with an account of what was spent. Single reasoning, read-only subagents and an unreachable System One fall back to mechanical rules labelled unverified: a hint on the first signal, a stop once it persists. It applies in yolo and auto modes too, and a turn with nothing moving for 15 steps always ends. Subagents share the same checks, and a stopped subagent hands its parent the reason. The session shows a one-line checkpoint such as `S1 · no progress for 9 steps (~40k tokens) · waiting on you`; checkpoints are recorded in the guard log and their System One tokens count toward the session's spend. Configure or disable it with `experimental.stop_loss`. The `subagent_progress` System One operation is now `session_progress`.

## 0.50.0

### Minor Changes

- d8a22a1: Design can run in its own process. With `design.app.mode: "process"`, redcode starts `redcode-design` on demand (from `REDCODE_DESIGN_BIN`, or from source in a checkout), finds it again through a private registration file and talks to it with a private token; the app serves the review page, the presenter and the previews, runs builds, renders and exports, reaches the conversation back through `design.host`, and exits after ten idle minutes. Review links carry a short-lived signed ticket that the app exchanges for a session cookie, so windows the review opens, such as the presenter, need no credentials of their own. The default stays `"inline"`, which runs everything inside redcode as before.
- 07ece41: Presentation designs are real decks: every `<section class="slide">` becomes a 1920×1080 slide, scaled to fit the review with a thumbnail strip, a slide counter and keyboard navigation (arrows, Space, Page Up/Down, Home, End), and review notes stay anchored to their slide. A Present button opens the deck in a full-screen window and a presenter view with the current and next slide, the speaker notes from `<aside class="notes">` and a timer, kept on the same slide over a BroadcastChannel. `design_export` gains a `pdf` format that prints one 1920×1080 page per slide without notes, the audit checks every slide for overflowing content and text under 24px, and the slides playbook is rewritten for the new runtime.

### Patch Changes

- 1396708: Task updates no longer fail when System One cannot review them. After a provider was reconnected, System One kept pointing at the removed key and every `todowrite` failed with "Stored System One credential does not belong to this transport and API origin". System One now switches to the provider's current connection and saves it. If there is none, it says to reconnect the provider in /setup. Re-saving a provider connection now keeps its credential id. When System One is unavailable, the task update is applied and labelled unverified. An inconclusive review adds a note and no longer rejects the update. A clear refusal still keeps the previous state, and plan handoffs stay strict. Refusal messages no longer say "Previous state preserved" twice.
- 6dac1ba: Fix `--yolo` silently disabling the loop guard. Yolo's blanket permission allow no longer counts as an explicit `doom_loop: allow` rule, so a session that keeps calling the same read-only tool with the same result still corrects and then stops the turn instead of repeating forever. The loop guard's correction message also now tells the model to stop polling and ask the user for the action it is waiting on, instead of just naming "change the arguments" as the only way out.

## 0.49.0

### Minor Changes

- 5d90627: App designs are now previewed in a phone frame drawn in CSS and SVG: an iPhone (Dynamic Island, status bar, home indicator) or an Android phone (punch-hole camera, status bar, gesture bar), scaled to fit the preview. An iOS/Android switch changes the frame and viewport and saves the platform on the design, so the agent sees it. The framed prototype gets the phone's safe-area insets as `--safe-area-top` and `--safe-area-bottom`. Annotation cards now land on the element in a scaled preview. Audit, compare and verify emulate each phone (viewport, device pixel ratio, touch, mobile user agent and safe-area insets). On app designs the small-control check uses 44pt on iOS and 48dp on Android. The `mobile-app` playbook now covers the app shell, the navigation stack, sheets, safe areas, touch targets, HIG versus Material, and screens and params as app navigation and states. The Design review notice in the TUI and the agent's per-turn Design context show each design's target. The review width picker offers the configured `design.breakpoints` for web designs.
- b0e03ff: Designs now have a target: `web` (a responsive frontend), `app` (a mobile app, optionally for `ios` or `android`) or `presentation`. With dual reasoning, System One classifies the request when the design agent creates a design (the new `design_target` operation), and you confirm the target in a question that has the detected target preselected and says why. If System One cannot answer, the agent's choice (or web) is preselected and the question says so. With single reasoning there is no System One call: the design agent sets the target itself. `redcode design --target web|app|presentation [--platform ios|android]` sets the target and skips detection. The review page's create form has a target picker, and the target can be changed later through the document update. The review width picker and the audit, compare and verify renders use the target's viewports: for web, the new `design.breakpoints` setting (default 390, 768 and 1440), for apps a 393×852 iPhone and a 412×915 Android phone, and for presentations 1920×1080. The agent is sent to the playbooks for the target, including a new `mobile-app` playbook that covers the basics of the Human Interface Guidelines and Material Design.
- 59f5c35: Subagent results are reviewed against their brief before they reach the parent. When a task has `scope`, `done_criteria` or `return_format`, the result is checked mechanically first (empty result, criteria never mentioned, no successful change, files changed outside the scope, verification commands whose latest run failed), then in dual reasoning by S1 with the brief and a bounded digest of the subagent's tool calls (unmet criterion, claim without evidence, out of scope, missing requested output, contradicts the brief). A result that needs revision gets exactly one repair round in the same subagent session and one more review. Every reviewed result carries a verdict, `verified`, `needs_revision`, `inconclusive` or `unverified`, as a `<review>` block in the task output (foreground and background) and as `metadata.review`; single reasoning runs only the mechanical checks and labels the result unverified, and an S1 failure fails open as unverified. Subagents under a structured brief skip their own generic response review, and S1 spend for subagent brief and result reviews now counts toward the parent session's spend and token budget. The task tool description explains how to read each verdict.
- 8663625: Redcode now manages the repository's local worktrees. `/worktrees` lists them in compact rows (`⎇ .red/worktrees/x  ⑂ x  1.2G  dirty·3d`) with their size, pending changes, merge state, recent activity and linked sessions. From there you can move the session into a worktree, remove one, or clean the merged ones, and you see the space freed. The same actions are available as `redcode worktrees list [--json]`, `redcode worktrees clean [--merged] [--stale <days>] [--dry-run] [--yes]` and `redcode worktrees remove <path|branch> [--force] [--delete-branch]`, and through new experimental HTTP routes. Removal never discards uncommitted work without an explicit confirmation or `--force`, and it never touches the primary checkout or the worktree of an active session. Clean only removes worktrees with no changes and prunes stale registrations.

### Patch Changes

- a2814b1: Design's session side is now one typed HTTP contract, `design.host` under `/api/design`: the conversation list, review launches, the feed, feedback, approval and permission requests. The TUI's Design picker and review command and `redcode design --open` use it instead of the untyped `/design/list` and `/design/session/:id/{open,launch}` routes, which are removed. Unused vendored export code leaves the package.

## 0.48.0

### Minor Changes

- 41945f0: Writing sessions now get their own worktree automatically. In a Git repository, the first edit, write or build command a session makes in the primary checkout creates `.red/worktrees/<name>` on a new branch `<name>` (named after the session, with `-2`, `-3` on collisions), moves the session and its subagents there and runs the action in it. The primary checkout is never stashed, reset or cleaned, and `.red/worktrees/` is added to `.git/info/exclude`. Reading never creates a worktree; non-Git directories and YOLO mode are unchanged. The session sidebar footer now shows the project, the worktree and the branch on three short lines.
- de9760f: Subagent briefs are reviewed before a subagent starts. The task tool takes `scope` (globs the subagent may change), `done_criteria` and `return_format`, and passes them to the subagent after its prompt. In dual reasoning, S1 checks the brief against the user's request, the goal, the tasks and the plan (missing criteria, scope, context or output, misalignment, overreach); a brief that needs revision fails the call with the issues and the questions to answer, and a second rejection for the same request lets the task run with a warning. Single reasoning checks the structure only and labels the task "not verified (single reasoning)"; an unavailable or undecided S1 lets the task run with a visible warning. Briefs from commands and @mentions are not reviewed. The accepted brief and its verdict are kept in the child session's metadata. Fan-out is capped in code: `experimental.subagent_limits.concurrent` (foreground subagents running at once per session, default 4) and `experimental.subagent_limits.per_request` (new subagents per user message, default 12), alongside `subagent_depth`. The task tool description no longer says subagent output should be trusted and explains the verdicts.

### Patch Changes

- 9cb404f: Follow the member that serves a RedRouter fallback combo. Discovery now keeps each combo's `parameters_basis` and `member_parameters`. When a response reports that a member other than the lead served it, the session switches to that member's context window (used for compaction), output limit, thinking levels (in the variant picker too), `thinking_can_disable` and forced tool choice. It switches back when the lead serves again. The member's parameters come from the saved catalog. A member missing from it is read once from `GET /v1/models/<id>`. The switch lives only in session memory: it never writes config or moves the catalog version. Combos whose parameters are the strictest member's, and RedRouters older than per-member parameters, behave as before.
- 36e6fea: File search on Linux no longer runs `ldd --version` to choose its native library, which could freeze redcode at startup under Bun 1.4.
- 0738e58: A hook or command that exits without reading its input no longer raises an uncaught EPIPE error.
- 04d1fde: Structured output (`LLM.generateObject`) now works on models that refuse a forced tool choice, such as Claude Opus 5.5, Fable and Mythos: it asks for the JSON object, validates it against the schema and repairs it once. A quota, credits or content-policy error that arrives mid-stream on the native Anthropic, OpenAI Responses or Bedrock paths is no longer retried, and a quota error says to check the plan and billing or switch models.
- ed58d3e: A language server that exits at startup no longer produces an unhandled EPIPE error. On Windows, redcode now also recovers Node language servers whose `NODE_OPTIONS` flag is rejected, restarting them without that flag.
- 069a25b: A background RedRouter catalog refresh now reloads the providers of the running server, so the TUI and web model pickers show new, removed and renamed models right away instead of after a restart; a refresh that only changed limits updates the pickers without a toast. RedRouter's review mode is selectable as a variant (TUI variant picker and web) and requests the router's review id, a model served through another router shows `via RedRouter → <router>`, and the v2 provider and model APIs report the router connection and each model's upstream provider, earlier ids, modes and router variants.
- 97beb4b: In dual reasoning, the prompt footer and the web indicator now name the S1 evaluator model (e.g. `S1 jev-1.13`) next to the S2 model, instead of a bare `S1 · S2`.

## 0.47.0

### Minor Changes

- 3ecdace: Setup recommends models from a connected RedRouter. When the router advertises recommendations, Redcode reads its `/v1/catalog` with the provider's key (cached per catalog version, skipped after 3 seconds or on any error) and `/setup`, `redcode setup` and the web settings list "Recommended: <model> · via RedRouter · <provider>" first, with the router's reason, preselected for the S2 principal and the transformations model. The detected RedRouter's S1 option uses the router's recommended System One model.

## 0.46.0

### Minor Changes

- 6dc888d: Remove a provider completely from `/connect` (Manage → Remove provider, or ctrl+d on a connected provider), the web settings, or `redcode providers remove <id>`. Removal deletes the saved key or login and the provider's global configuration entry, clears the default, small, agent and command models, the enabled and disabled provider lists, System Two models and a System One evaluator that use it, and forgets its cached router detection and learned limits. A confirmation first shows what is in use, which project files still mention it and which environment variables would bring it back. Connecting a provider again takes it off `disabled_providers`, and `redcode providers list` now shows providers that are configured without a saved credential.
- 1e1e4c8: Show where every model comes from: models served through a RedRouter are grouped by the upstream provider behind them and labeled `via RedRouter · <provider>` (with `subscription` for subscription accounts), directly connected providers are labeled `direct`, and a model available both ways says so. The prompt footer, `/setup` and the web model picker use the same labels, the session header shows the model RedRouter actually served, reasoning levels and modes (such as review) appear on their model instead of as separate models, and the web settings name a RedRouter connection instead of calling it custom. Connections now record which router they are, and after RedRouter switches to readable model ids (`codex/gpt-5.6-sol` instead of `cx/gpt-5.6-sol`) saved models, default and agent models, favorites, recents and System Two models move to the new ids while old ids keep working. A background catalog refresh that changes the models shows a notice.

## 0.45.3

### Patch Changes

- 7562a96: `/setup` lists every connected provider at the top of the S2 model step, so switching from RedRouter to OpenRouter (or connecting another provider) no longer hides at the end of a long model list. A failed "Test and save" now names the model and shows the provider's own message instead of raw nested JSON (for example `S2 model RedRouter / Go Model failed (HTTP 400): Upstream request failed: …`), offers "Change S2 model" next to "Back to S1 connection", and leaves the cursor on the option that fixes the failing role. The "Test and save" explanation now shows on its own line instead of being cut off.

## 0.45.2

### Patch Changes

- ccef3e2: `/setup` no longer stops at "Test and save" with "Generative connection checked" shown as an error: the S2 connection test gives reasoning models (Opus 5.5, GPT-6, Fable) room to answer, accepts a response that ends at the length limit, and reports the real reason when the connection fails.

## 0.45.1

### Patch Changes

- 95a9741: Fix compaction replay, session forks and diff summaries failing on a structured output turn with `Expected OutputFormatJsonSchema`.
- 8110a0c: Never send a forced tool choice to models that refuse one (Claude Opus 5.5, Fable, Mythos, or a RedRouter that declares it): session requests ask for the tool instead, and agent generation falls back to prompted JSON with one repair attempt.
- b778252: Exhausted accounts are no longer retried as if they were rate limits. HTTP 402 and gateway account caps such as OpenCode Zen's free-tier and credit limits, `insufficient_quota`, usage limits and OpenRouter credit errors now stop the turn at once with a message saying the account's quota, credits or free-tier limit is exhausted, instead of retrying for minutes. Content-policy refusals are not retried either, and a 4xx rejection whose body carries a gateway's substituted `server_error` code is no longer retried.
- 3fccf50: Name a new session with its own model when the small title model fails or answers with nothing usable, retrying once.

## 0.45.0

### Minor Changes

- ac557c8: Add an `auto` reasoning variant. Pick it in the variant picker (listed first when the model has two effort levels or more), with `ctrl+t`, with `--variant auto`, or as an agent's `variant`. Each turn then runs at one of the model's own effort levels. The level is chosen where you speak and is held for two turns. It uses System One's reading of your message, including a new judgement of whether you agree with, correct or reject the previous answer, along with the size of the context, the plan agent and an explicit "think hard" or "pense bem". It steps up at most once inside a tool loop that keeps failing or looping. You can bound it with `reasoning.auto.floor` and `reasoning.auto.ceiling`.

  Redcode now coordinates effort with RedRouter so that only one side decides. With System One, Redcode decides: it sends `x-red-router-reasoning: off` to direct models and the level to auto or smart combos. Without System One, a RedRouter whose reasoning autopilot accepts `auto` decides. It receives the loop's stall signal and reports its level, which the prompt footer shows. A variant you picked yourself is never overridden (`off`). The footer shows the effective level (for example `auto → high · frustration` or `router: medium`), and each answer shows the level its turn used.

## 0.44.2

### Patch Changes

- f933f64: Read RedRouter's model parameters and catalog version: a combo that any member refuses forced `tool_choice` for is asked with `auto` instead, discovery keeps the parameters and combo members the router reports, and when a response carries a newer catalog version the saved models of that connection are refreshed in the background.

## 0.44.1

### Patch Changes

- 120c6d0: Language servers that exit at startup (for example when their Node rejects a `NODE_OPTIONS` flag) no longer surface an unhandled `EPIPE` from the client's first write; the restart without the rejected flag proceeds as intended.
- a05bc8a: Remote MCP servers that rotate refresh tokens no longer lose their sign-in when several connections refresh at once. Concurrent refreshes of the same token now share one request, and a connection whose stale token was rejected no longer deletes the newer tokens another connection or process already stored.
- 875f7c9: Claude Opus 5.5 and GPT-6 models now work with the same defaults as their predecessors. GPT-6 Sol, Luna and Astra get medium reasoning effort, reasoning summaries and encrypted reasoning on OpenAI, Azure, GitHub Copilot and OpenCode Zen, plus the Codex subscription context limits. Claude Opus 5.5 shows summarized thinking without picking a variant, and structured output on Opus 5.5, Fable and Mythos asks for the StructuredOutput tool instead of forcing it, which those models reject. GPT Luna is now the preferred small model for titles and summaries.
- b37e57e: `--verbose` now explains prompt cache misses. Each provider request logs a `prompt.cache` entry that compares it with the session's previous request: `initial`, `stable`, `append-only`, or `changed:<component>` naming the first model setting, tool, system part or message that changed. Only hashes are kept, for at most 100 sessions, and nothing is computed without `--verbose`.
- c4ab71a: Provider-requested retry waits (`retry-after`, `retry-after-ms`, and a router's `X-9Router-Retry-At`) are now capped at fifteen minutes, so a hostile or buggy header can no longer stall a session for hours or days.
- d491b62: Catch up with upstream quick wins: GPT-6 models use the Astra system prompt; every GitHub Copilot Claude model with adaptive thinking requests summarized thinking; Amazon Bedrock models other than Claude, Nova and Llama 4 get tool-result images as a follow-up user message instead of failing; DashScope's "Range of input length should be" errors are treated as context overflow; `/effort` opens the model variant picker; and code-mode programs receive JSON returned as text by MCP tools without an output schema as an object.

## 0.44.0

### Minor Changes

- 49666bc: Add single and dual reasoning modes. Unconfigured redcode now runs in `single` mode on the session's selected model (S2 only): completion gates keep their structural evidence checks and executed shell gates and report S1 as "not verified (single reasoning)". `dual` adds the System One evaluator with the existing strict contract, where an unavailable or inconclusive review is never approval. Choose the mode per run with `--reasoning single|dual` or `REDCODE_REASONING`, overriding the saved setting; settings saved with an enabled evaluator stay dual.
- bcfc4da: Detect RedRouter behind a connected provider and cooperate with it. Redcode probes the router's capabilities when it is connected (and lazily, cached for five minutes, failing open), keeps each model's combo strategy, capabilities and thinking levels (which become the model's reasoning variants), and reports a connected RedRouter that serves System One in the intelligence status. A RedRouter's own decision layer is turned off for turns System One already guided, and its token saver for compaction and goal checks. Spend now counts the cost RedRouter reports for combos and routed models, retries wait until the instant a 9Router-family router names, and a router with no active account for the model is not retried. The provider's key is shared with System One for the address it was connected at, with `localhost` and `127.0.0.1` treated as one; the RedRouter System One preset now uses `127.0.0.1`.
- 270c258: Steer RedRouter combos with System One. In dual reasoning, when the selected model is a RedRouter combo with the `auto` or `smart` strategy and the router accepts hints, each turn sends an `x-red-router-hint` built from System One's classification: complexity and deliberation as units, `needs_tool` when System One recommended a skill or MCP tool, and a tier from the complexity bands. The router picks the model for the turn; Redcode never switches it. A hint outside the router's grammar is never sent. `/setup` (TUI, CLI and web settings) now offers a connected RedRouter that serves System One as the first System One option, saving an evaluator that points at the router and shares the provider's credential.
- 4c54541: Rework `/setup`, `redcode setup` and the web intelligence settings around the reasoning mode. Setup now starts by choosing Simple (one model) or Dual (S1 classifies and validates, S2 executes), preselecting the effective mode and noting a `--reasoning` override. A saved System Two model can be kept with "Continue with…" instead of walking through the model list again, and dual setup offers the same shortcut for a saved System One evaluator. Simple reasoning never asks for or probes an evaluator; a previously saved System One evaluator is kept (unused) so switching back to Dual can continue with it.

### Patch Changes

- 5e6ca82: Make the intelligence setup inherit the active System Two connection, limit model choices to that connection, filter System One catalogs to evaluator models, and suppress expected renderer listener warnings.
- d49bf6d: Command hooks that exit without reading their input no longer crash with a broken-pipe error.
- 93c02bb: Terminals whose command exits immediately now report their exit instead of staying "running" forever.

## 0.43.0

### Minor Changes

- 5a6b2f1: Expose a local voice input sink so compatible dictation tools can update the focused TUI composer without submitting prompts automatically.

## 0.42.0

### Minor Changes

- 0af649a: Require configured S1 and S2 models before session execution and show their effective roles in the terminal and app. Make prompt assessment contextual, recommend permitted skills and MCP tools with clear selection logs, review tool evidence at turn boundaries, and use typed S1 evaluation for goals, plans and automatic compaction in both runtimes. Preserve unresolved decisions and retry history, validate classification answers, and repair candidate-free evaluation persistence.

## 0.41.2

### Patch Changes

- 3dfef81: Keep local diagnostic logs at their established paths with automatic size rotation, private creation, credential redaction and durable CLI fatal errors. Add `redcode debug logs --path` and `--open` for predictable troubleshooting and desktop log access.

  Bound desktop log history and include the current RedCode log location in desktop debug exports without dropping legacy sources.

## 0.41.1

### Patch Changes

- 6221b18: Use System One to shortlist relevant skills, review final claims against tool results, and reuse Cloudflare Workers AI credentials for Jev evaluation.
- 096825e: Keep global intelligence setup usable when provider reloads or System One probes fail, preserve entered credentials for retry, and prevent expected bootstrap concurrency from emitting listener leak warnings.

## 0.41.0

### Minor Changes

- 338ccdd: Add continuous System One evaluation for promoted prompts, task quality, final responses, and compaction checkpoints. Prompt classification now evaluates the original request without an artificial candidate, separates work route, change kind, impact, time pressure, interaction constraints, clarification need, complexity, consequence, and frustration, and derives priority only from confident impact and timing evidence. Persist typed evaluation metrics, retain compressed evidence artifacts for 30 days, allow one tool-free response correction, and expose filtered evaluation history.

  Add optional shared RedDB storage through `REDCODE_DATABASE_URL` or global `database.url`, plus database status and explicit verified SQLite-to-RedDB migration commands. SQLite remains the default when no RedDB URL is configured.

  Add an English prompt-classification dataset and a live System One evaluation harness that compares providers, repeated-run stability, field accuracy, confidence, latency, and token usage.

### Patch Changes

- c1fc7ff: Keep the Azure authentication plugin bundle self-contained when it runs under Node.js.
- c5d1386: Allow connected providers to replace their saved API key or login from `/connect`.

## 0.40.4

### Patch Changes

- 20616c7: Keep the TUI usable when a project custom tool fails to import, update the bundled GitHub PR search tool to use the Redcode plugin package, and cycle native modes as Build, Plan, Design, then Question.

## 0.40.3

### Patch Changes

- 28ac03e: Offer OpenRouter as a System One connection and route JEV through its Decisions API.

## 0.40.2

### Patch Changes

- 2a7bf1f: List every cataloged JEV provider in global System One setup, put configured connections first, reuse existing `/connect` credentials, and add native Cloudflare, Vercel, Vivgrid, and NanoGPT evaluation transports.

## 0.40.1

### Patch Changes

- a319817: Automatically continue provider turns after transient connection resets. Preserve partial output and completed tool results, retry up to three times, and avoid repeating side effects.
- 9b06bcb: Render plan approval previews as Markdown in the TUI so headings, lists, tables and code blocks remain readable before execution.
- 6f18801: List configured providers first in the TUI connection picker and let `/connect` and `/setup` reuse an established provider without repeating authentication.
- ccd8b84: Stop provider turns that repeat the same progress update and unchanged tool result while varying command syntax. Preserve polling when tool results continue to change.

## 0.40.0

### Minor Changes

- 5df51fd: Add optional global System One evaluator and principal/fast System Two roles, with CLI, TUI and app onboarding. The TUI can connect a generative provider inside setup, return to the preserved step, choose or reuse the System Two models, and later edit System One or System Two independently. Validate task completion, plans, design feedback and compaction against source evidence using native TypeSafe or RedRouter System One requests, preserving existing state when checks cannot approve a change.

### Patch Changes

- 5df51fd: Recommend OpenCode Zen with Jev Free in global CLI, TUI and app onboarding. Preserve configured evaluators, test availability before activation, and never automatically fall back to a paid model. Keep Jev out of generative role selection.

## 0.39.0

### Minor Changes

- d84a175: Compaction summaries survive an output-limit cut and the summary budget is configurable. A summary whose provider finish was `length` (common with reasoning models that spend the output budget thinking, e.g. GLM-5.3-Flash) is now committed instead of failing the compaction and preserving the full history. The summary output budget defaults to 32k tokens (was 16k) and can be changed with `compaction.summary_max_tokens` in config; the model's own output limit still caps it.
- 572b04f: Add the green Question mode to the current session engine for focused investigative questions, with read-only tools and no shell, editing or delegation by default. Align the legacy mode with the same behavior.
- 887de9c: Add a fourth built-in mode: `question`. It can only read — its mission is to explain how something works, citing files and line numbers, never writing code or editing files. Selectable alongside build, plan and design.

### Patch Changes

- 35e9ec3: RedRouter is now offered as a provider in the TUI connect dialog, like 9Router: picking it opens the wizard with the id, name and default API URL (`http://127.0.0.1:25050/v1`) prefilled, and a configured RedRouter connection pointing elsewhere offers to move to its own id. Model discovery already picks up the per-model and per-combo context and output limits RedRouter reports in its OpenAI-compatible model list.

## 0.38.4

### Patch Changes

- e670dcb: Fix sessions failing with "no schema with key or ref https://json-schema.org/draft/2020-12/schema" when an MCP server publishes tool input schemas that declare a JSON Schema dialect redcode's validator does not register (the zod v4 default). The advisory `$schema`/`$id` keys are ignored before compilation, and a tool whose schema still cannot be compiled is now skipped with a warning instead of taking down every session of the project.

  A broken MCP server can no longer take the session down either: failures and defects while registering one server (an invalid `url`, for example) are contained to that server, which stays paused with a warning while every other server keeps working.

- eea0eca: Monitors are transparent and their results know when they stopped mattering. A monitor recovered after its runtime died is settled as `expired` (or `interrupted` when the loss was mid-flight) and its result is queued for the session instead of being silently suppressed, with `monitor.started` / `monitor.finished` / `monitor.expired` events on the session bus. The queued result carries the origin state - tasks closed and newer instructions since the monitor started - and the wake is skipped when the person has already spoken, so a session is never woken for an observation their newer instructions superseded. The probe instructions now teach pointing the success condition at the final state that matters and sizing `interval_ms` as the check budget.

## 0.38.3

### Patch Changes

- e656083: Context-overflow refusals in the OpenRouter phrasing ("the request resolved to N input tokens (including image/vision expansion)") now teach the session the provider's real limit. Without the number extraction the learned limit stayed empty, the compaction threshold kept sizing against the catalog's overstated window, and the session could repeat the same 400 on every attempt instead of compacting preventively.
- e656083: Unexpected server errors are transparent now. The 500 body carries the real cause's first line, the `err_xxxxxxxx` correlation ref and the exact log file (`~/.red/code/data/log/redcode.log`) instead of a bare "check server logs for details", so a failed prompt can be diagnosed from what the UI already shows. The response never includes the stack.
- e656083: The TUI todo panel keeps the thread's work in view instead of its whole history: open tasks always show, while completed and cancelled ones stay only for 15 minutes after they closed (the store now stamps each task with `closedAt`) and then fall away.

## 0.38.2

### Patch Changes

- bf722a9: Make compaction survivable when the context is already at the provider's limit. The compaction threshold now starts 5% below the refusal boundary so a small estimation error cannot overflow first, the summary request is sized by the limit the provider taught us instead of the catalog's (which can overstate it — z-ai/glm-5.3-flash claims 1.3M while OpenRouter enforces 1.05M), and a transcript that no longer fits beside its summary is compacted by keeping the newest part and eliding the middle instead of giving up — a session the provider already refused once now recovers instead of looping on 400s.
- bf722a9: `todowrite` updates addressed by `id` no longer require the revision: an update without one applies against the stored revision, so a batch where one item omits it is no longer refused outright. A supplied revision that no longer matches is still refused, and the refusal now quotes the current revision with the exact update to resend.
- bf722a9: The TUI context sidebar shows only the current step's latency and tokens per second. The time-to-output breakdown, the turn totals and the aborted, burst and reasoning-hidden markers are gone; when there is no real rate, nothing is shown instead of an explanation.

## 0.38.1

### Patch Changes

- 7f0848e: Make compaction survivable when the context is already at the provider's limit. The compaction threshold now starts 5% below the refusal boundary so a small estimation error cannot overflow first, the summary request is sized by the limit the provider taught us instead of the catalog's (which can overstate it — z-ai/glm-5.3-flash claims 1.3M while OpenRouter enforces 1.05M), and a transcript that no longer fits beside its summary is compacted by keeping the newest part and eliding the middle instead of giving up — a session the provider already refused once now recovers instead of looping on 400s.

## 0.38.0

### Minor Changes

- cc9c97d: Add a RedRouter provider preset: `POST /provider/red-router/connect` connects a RedRouter instance like the 9Router preset, and discovery stores the router-reported context/output limits on each model so compaction and request sizing use real limits instead of guesses.

### Patch Changes

- 490a323: `design_read` no longer refuses with "No approved Design revision is recorded" while prototyping. Before any approval, every section (decisions, scenarios, feedback, assets, evidence, prototype, files) reads the requested or latest published revision and labels the output as not approved; after approval, the frozen package answers as before.
- 52b3128: Make prompt failures visible and survivable. Model resolution now retries transient provider-catalog failures (network, models.dev fetch) a couple of times before giving up, and publishes the provider's real message as a session error when resolution fails — instead of dying with an opaque defect that rendered as "unexpected server error. check server logs for details." with nothing behind it. The /api server also logs every uncaught defect with an `err_xxxxxxxx` ref (and returns the ref in the 500 body), so an intermittent failure is diagnosable from the logs.

## 0.37.0

### Minor Changes

- 4e43804: Latency and output speed now measure the model, not the work around it.
  - **Output speed counts only generation.** Speed is tokens per second between the first non-empty token (text, reasoning, tool input, or a tool call without streamed input) and the last token before the step finished. Both ends are stamped when the output arrives from the provider, not when the session gets round to handling it. Tool runs, permission prompts, snapshots, hooks and slow plugins no longer count. For example, a step that wrote 120 tokens in half a second and then ran a test suite for 1.5 seconds used to show about 60 tk/s and now shows about 250 tk/s.
  - **Hidden reasoning is left out.** Reasoning models report every reasoning token, but only a short summary streams, late. When the reasoning that streamed is far shorter than the reasoning reported, speed rates the visible output alone over the visible part of the window and says so (`tk/s (reasoning hidden)`). For example, 1,200 hidden reasoning tokens and a one-line summary, then 80 text tokens over 400 ms, now show about 200 tk/s instead of thousands.
  - **Latency starts when the request goes out.** Time to first token is measured from the HTTP attempt that produced the answer: the AI SDK provider call, or each native request attempt. Local preparation (tools, MCP, snapshots, plugins, auth), a failed attempt before a retry, and a 429 or 503 backoff before a resend are all excluded. An empty `reasoning-start` or block opening no longer counts as the first token. The app's context tab also shows the time to the first visible token and the local preparation separately.
  - **No number when there is nothing to measure.** A step whose tokens mostly arrived at once (a non-streaming proxy) shows `burst` instead of the local write speed. Fewer than 20 tokens, or a window under 300 ms, shows no rate. Compaction summaries, which replay collected events, are skipped by both the TUI and the app. So are messages recorded before this release, because their numbers counted tool runs.
  - **Live and per turn.** Latency is written as soon as the first token arrives, so it shows while the step streams. Values from a finished or aborted step are dimmed. When a turn has more than one step, the TUI sidebar and the app's context tab also show the turn's speed (total tokens over total generation time), the latency of its first step, and how many steps it rated. Subagents run in their own sessions and are not part of the turn. The app formats numbers in the selected language.

  Assistant messages gain an optional `timing` object (`requestStarted`, `firstToken`, `firstVisible`, `lastToken`, `prepMs`, `ttftMs`, `visibleMs`, `genMs`, `visibleGenMs`, `idleMs`, `outputTokens`, `reasoningTokens`, `reasoningChars`, `burst`, `replayed`). Durations come from a monotonic clock. `time.first` is still written for older clients.

- 9ba05d5: The `todowrite` refusal for an update that names neither `id` nor `content` now lists the existing tasks with their ids, revisions and titles, so a model that sends an evidence-only item can resend the exact update instead of retrying the same malformed shape.

### Patch Changes

- 0947b32: Preserve explicit Amazon Bedrock model ARNs and DeepSeek V3.2 IDs, while retaining regional inference prefixes for DeepSeek R1 in both Core and the CLI.
- da22b7f: Output tokens are no longer lost when an OpenAI-compatible server counts reasoning apart from them.

  OpenAI reports reasoning tokens as part of `completion_tokens`. Some OpenAI-compatible servers, and the proxies in front of them, report `completion_tokens` as the visible answer only and add the reasoning on top; their `total_tokens` shows it (`prompt + completion + reasoning`). Redcode subtracted reasoning from completion anyway, so a reply with 120 visible and 800 reasoning tokens was stored as 0 output tokens.

  Such usage is now recognised from the provider's own total, and only from it: with no `total_tokens`, or a total that already contains reasoning, nothing changes. Both runtimes are affected: the AI SDK path (`@ai-sdk/openai-compatible`) and the native OpenAI Chat protocol, which the V2 runtime also uses.

  **Cost and budget impact.** For those providers only, a step's output tokens now include the visible answer that used to be subtracted away. In the example above, the 120 output tokens are now counted, so:
  - the step's cost rises by 120 × the model's output price;
  - session and goal token totals rise by the same amount, and spend budgets and goal token budgets (legacy and V2) reach their limits correspondingly sooner;
  - compaction and overflow estimates, which use the reported output, see the larger context.

  Providers that report reasoning inside completion (OpenAI, and xAI and Gemini through their own AI SDK providers) are unchanged.

- bc090df: Reduce CI flake from slow `bun run` startup in subprocess tests and an `active`-marker race in the flock stress test.
  - `packages/opencode/test/lib/cli-process.ts` — prefer the prebuilt `redcode` binary (`dist/redcode-linux-x64/bin/redcode`) over `bun run --conditions=browser src/index.ts` when the binary is present. Cuts subprocess startup from ~20s to ~5s and keeps the run-process tests comfortably under their 30s `timeoutMs` even when many tests run concurrently.
  - `packages/core/test/util/effect-flock.test.ts` — drop the `active` marker from the mutual-exclusion stress test. The marker sits outside the lock directory, so its `wx` create races between a holder's `fs.rm(active)` and the next holder's `fs.writeFile(active)`; on Windows the race window is wide enough to produce intermittent non-zero exits even though the flock itself is correct. The serialized work + `done.log` line count are sufficient to prove mutual exclusion.

- 15c44b9: The V2 runtime (`redcode design`) records latency and output speed per step, the way the legacy runtime does.
  - **What is recorded.** Each provider step records its request start (per HTTP attempt, so a rate-limit backoff inside the provider client is excluded), and its first token, first visible token and last token as they arrive. It also records output and reasoning token counts, the reasoning that streamed, and whether the tokens arrived as a burst. Durations use a monotonic clock. Tool runs, hooks and snapshots fall outside the generation window.
  - **Where it is stored.** The step's settlement event and the projected assistant message carry it as `timing`. Nothing displays it for V2 sessions yet: the TUI sidebar and the app read legacy messages.
  - **When it is written.** Only when the step settles. Unlike the legacy runtime, a V2 step has no live first token while it streams.
  - **Older sessions** without `timing` load as before.

- a8c4a05: Update the GitLab provider to 6.15.0 in Core and the CLI, adding GPT-6 Astra model mappings with Responses API routing.
- b101ba2: Open Redcode directly in the full chat shell, including for profiles that previously selected the legacy interface.
- 5803b39: Show reasoning token counts in the TUI thinking header. While the model thinks, the spinner reads `Thinking: title · 1.3K tokens`, updating live from the message's reasoning tokens, and the finished line reads `Thought: title · 2s · 1.3K tokens` using compact `Locale.number` notation.

## 0.36.2

### Patch Changes

- 310782e: A single-line paste now stays as visible text up to 250 characters (was 150) before the prompt folds it into `[Pasted ~N lines]`, so a dictated sentence is readable in the prompt. Pastes of three or more lines are still summarized.
- 1f6a8a8: Sign in to MCP servers without leaving the TUI. `/mcp` (palette: "MCP servers") lists each server with its status, tool count and OAuth state, and offers Authenticate, Log out, Reconnect and Enable/Disable. Signing in opens the browser once and reconnects the server in the running session; when no browser can open, or the TUI is attached to a server on another host, copy the URL and paste the redirected address back. A server that needs authentication, including after its token expires mid-session, raises one notification with an Authenticate button, and its sidebar entry is clickable. The server adds `GET /mcp/info`, `POST /mcp/:name/auth/wait` and `POST /mcp/:name/auth/cancel`. Pasted codes can carry the attempt's `oauthState`, and `mcp.auth.cancel` takes it too, so a late cancel from a replaced dialog cannot end a newer attempt. A 401 on a live connection now asks for sign-in only when the token could not be refreshed. Servers with `oauth: false` report `failed` instead.

  Older TUIs attached to this server no longer receive the server-side "Run: redcode mcp auth" toast when a server needs authentication. They still show the status, and `redcode mcp auth <name>` still works.

## 0.36.1

### Patch Changes

- e082bc9: Ctrl+Shift+V now pastes from the clipboard like Ctrl+V. Under the kitty keyboard protocol, terminals and multiplexers such as zellij forward it as a key instead of pasting, and dictation tools emit it, so it did nothing before. A terminal that forwards the key and also pastes no longer inserts the text twice.

## 0.36.0

### Minor Changes

- 5ebe263: `/connect` → **OpenAI-compatible** connects any endpoint that speaks the OpenAI API without editing JSON: enter the API URL, a provider id (suggested from the host), a display name, the API type (Chat Completions or Responses) and a key, pasted into the credential store or kept as an `{env:VARIABLE}` reference in configuration. Models come from the endpoint's `/models` list with their limits; when that fails or is empty you type the model ids instead of hitting a dead end. Running it again for an id updates that provider, built-in ids ask before being overridden, and the message at the end names the configuration file that was written. It replaces the credential-only **Other** entry. **9Router** is now a preset of the same wizard, and a `9router` provider that points to another endpoint can be moved to its own id. The server route `POST /provider/openai-compatible/connect` does the checks, discovery and saving in one call; `POST /provider/9router/connect` is a thin wrapper over it.
- dba3f94: Each Redcode tab uses less memory, and `redcode debug memory` shows where it goes.
  - **About 150 MB less per TUI.** A tab measured 696 MB (proportional set size) after boot, 782 MB after a session with tool calls and 683 MB after ten idle minutes; it is now 553 MB, 604 MB and 527 MB. The peak during a session fell from 968 MB to 737 MB, and `redcode serve` boots in 213 MB instead of 315 MB.
  - **Services are built once.** The service graph is shared: a service many others depend on was compiled once but built again for every path that reached it, about a hundred thousand throwaway scopes and fibers when a project opened. Each service is now built once per project, which also shortens startup work.
  - **The TUI keeps only what it shows from the provider list.** The list carries every model of every catalog provider (6 MB of JSON); the TUI keeps provider ids, names and credential variable names.
  - **Babel loads when a TUI plugin needs it.** The Solid transform for plugin files no longer loads Babel at startup.
  - **SQLite's page cache is 8 MB per process instead of 64 MB.** File pages are already cached by the operating system and shared by every process; on a large database the private cache added up to 87 MB per tab without making queries faster.
  - **`redcode debug memory [pid]`** lists running redcode processes with resident and proportional memory, swap, threads and child processes (language servers, MCP servers), and asks each TUI or `redcode serve` from this version for the JavaScript heap of every thread and the size of its caches. Processes started by an older version are listed but never signalled.

### Patch Changes

- 57af46f: Shift+Enter inserts a newline again when the terminal sends it as `ESC CR`. Since 0.35.1 that byte pair counted as Alt+Enter, so it submitted the prompt when idle and steered while busy. That is what the VS Code and Cursor `sendSequence` binding, Alacritty `chars` mappings and tmux send. A bare `ESC CR` is a newline once more (`input_newline` lists `alt+return` again). Alt+Enter steers, or submits when idle, only when the terminal reports it unambiguously: through the kitty keyboard protocol (`CSI 13;3u`) or modifyOtherKeys (`CSI 27;3;13~`). The newline reports `CSI 27;2;13~` (WezTerm and xterm defaults), `CSI 13;2u` (kitty protocol) and `Ctrl+J` keep working. WezTerm binds Alt+Enter to fullscreen by default, so while the agent works the prompt hint there now shows `/steer`, just as it does in terminals without the kitty protocol.

## 0.35.2

### Patch Changes

- 7a35b8f: Several Redcode processes on one database (TUIs, `redcode serve`, `redcode run` workers, the design server) no longer trip over each other.
  - **Write transactions begin with the write lock.** Every transaction on the shared database now begins `IMMEDIATE`, so one that reads before it writes cannot fail with `SQLITE_BUSY_SNAPSHOT` when another process commits in between — a failure the busy timeout never waited out. A transaction that finds the lock held past the timeout is begun again, whole, a bounded number of times with jittered delays.
  - **Migrations are safe to run from two processes at once.** Schema creation and each migration take the write lock before deciding what to do and re-check the journal under it, so the second process waits and then no-ops instead of failing on a table or column the first already created.
  - **Session updates are transactional.** Every change to a session writes its whole row back, `metadata` (spend, goal status, compaction state) included; the read and the write now run inside one transaction, so a title change or a `touch` in one process can no longer overwrite the spend or goal pause another process committed in between. In-memory listeners hear of a change only once it has committed.
  - **Lock contention surfaces sooner, migrations wait longer.** A statement waits 1 s (was 5 s) for another process's lock before the transaction is retried, so a TUI stuck behind another writer sees the error after about 8 s instead of hanging for over half a minute; migrations, which may wait on a long table rebuild in another process, retry for 10 to 20 minutes and log each wait.
  - **The database is closed on the way out.** The CLI, the TUI server thread and `redcode serve` (on Ctrl-C, and on SIGTERM where the platform delivers it — Windows does not) dispose the runtime — with a bound, so a stuck subprocess cannot keep the process alive — running `PRAGMA optimize` and letting SQLite fold the WAL back into the file.

## 0.35.1

### Patch Changes

- a077a43: Steer moved from Shift+Enter to Alt+Enter; Shift+Enter always inserts a newline. While the agent works, Alt+Enter delivers your prompt at its next step (Enter keeps queueing it); when the session is idle, Alt+Enter submits like Enter. Pressing it with an empty prompt still steers the latest queued prompt. An explicit `input_steer: "shift+return"` in `tui.json` is still honoured. macOS Terminal.app needs "Use Option as Meta key" and Windows Terminal needs its default `alt+enter` fullscreen binding removed; until then the busy hint points at `/steer <text>`, which works in every terminal.

## 0.35.0

### Minor Changes

- 2f9ec10: Design mode enforces the fix-round gate.
  - **Status gate.** `design_document update notes` refuses `resolved` unless it cites a completed verify job on the current revision that found the note's element with no blocking finding; `partial` needs such a job and a reason; `unresolved` and `accepted` need a reason. A refusal lists the recent verify jobs, so the agent acts on it instead of resending, the way the todo evidence gate names callIDs.
  - **No approval or ending with open notes.** `design_exit` (both runtimes), the approval routes and the review page's "Send & end" are refused while any feedback round still has notes without a recorded status (listed per round); unresolved or accepted with a reason are allowed. The page hides "Send & end" and says why until the rounds are recorded, and a refused "Send & end" keeps the draft and retries as a plain send.
  - **The reviewer can close a note by hand.** In the review page's rounds panel each open note can be recorded as accepted or unresolved with a reason, and the Approve dialog lists the notes the agent declined or left unresolved (with their reasons) and offers, when notes are still open, to record them as accepted by the reviewer and approve. Statuses recorded this way carry `by: "reviewer"`; the agent's tools cannot record as the reviewer, and the reviewer cannot record `resolved` or `partial`.
  - **The round rule in the message and the prompts.** Every `<design-review>` with notes ends with the rule: fix everything in this round, publish one revision, run one verify for the round, then record each note's status with evidence, naming the message's note ids. The Design instructions replace the per-fix "verified only after an audit" sentence with the round rule, and the screen playbook gains a "Feedback round" step (collect → fix all → publish → one verify → statuses → summarise and ask before another round).

- edae950: Design mode keeps track of feedback rounds and verifies each round in one job.
  - **Rounds and note statuses.** Review notes sent from the browser are recorded on the design document: notes arriving before a revision answers them form one round, and the first `design_preview` after them closes it. Every note carries a durable status (`open`, `resolved`, `partial`, `unresolved`, `accepted`) that the agent records with `design_document update notes: [{feedback, index, status, reason?, evidence: {job}}]`; the evidence copies the verify job's capture and findings for that note.
  - **One verify per round.** `design_export` gains `format: "verify"` (optional `round`, latest by default). In one job it renders the new revision and, for each note of the round, locates its element by `data-design-id`, selector or XPath in its variant, parameters and screen, captures a focused crop on the revision the note was taken on and on the new one, runs the scenarios of that screen and axe and layout checks scoped to the element's container, and reports one line per note, including "element not found" when it disappeared. Only a new serious or critical violation blocks a note; what the container already had before the fix is reported as pre-existing. Every note of the round is verified, each within its own time budget, and finished notes are kept even when a later one times out. `design_jobs` prints the per-note lines with the capture paths to cite and names notes that joined the round after the verify ran.
  - **Review page.** The conversation feed shows a verify's verdict per note (pass, findings, missing) with a link to the report and its captures; a "Feedback rounds" section lists every note with its status and reason, and a partial or unresolved note goes into the next round with one click.
  - Both runtimes (TUI and `redcode design`) and both conversation feeds carry the new entries. Restoring an older revision keeps the review's rounds and statuses. Existing documents without rounds decode unchanged.

- fdfed38: Add a global `--verbose` flag (also `REDCODE_VERBOSE=1`). It traces the boot to stderr, one line per phase with elapsed and delta times — config files, models catalog origin and age, providers found, plugins, MCP servers with connection time and status, LSP servers, server address, instance, TUI mount and first render — and stops at the first rendered frame with `boot complete in N ms; log at <path>`. Under the TUI the trace continues in `<data>/log/boot-<timestamp>.log` and the footer shows where; `redcode run --verbose` prints everything to stderr. After boot it traces activity at DEBUG with a `verbose=<event>` tag: provider request/response/retry (model, tokens, duration; never bodies or keys), tool start/end (duration, output size), permission ask/reply, compaction decisions, guard trips, inbox promotions, monitors and learned model limits. `redcode debug startup` prints the same phases.

### Patch Changes

- e65319a: `redcode run` boots one instance, in the directory it was started in (or `--dir`). It used to derive the session's directory from `PWD` while the instance it booted came from the process's working directory; when a spawner set the working directory but left another shell's `PWD` in the environment (CI runners, process managers, editors), the in-process server loaded a second instance for the session and the turn's tools ran there. A relative `--dir` now also resolves against the working directory rather than `PWD`.
- Updated dependencies [edae950]
  - @reddb-io/redcode-schema@1.23.0
  - @reddb-io/redcode-client@1.18.24
  - @reddb-io/redcode-design@0.0.3
  - @reddb-io/redcode-llm@1.19.2
  - @reddb-io/redcode-protocol@1.18.24
  - @reddb-io/redcode-server@1.18.30
  - @reddb-io/redcode-tui@1.22.2

## 0.34.1

### Patch Changes

- 594c7f5: todowrite accepts every shape its description asks for. An update that names only a task's id, revision and the fields that changed no longer fails with "Missing key" when the unchanged status is left out; evidence without an explanation is answered with the exact update to resend instead of a schema error; a scopeChange without the message id is linked to the latest request. A schema refusal now names every wrong key and its path on its first line, so the TUI row, the log and `redcode debug todos` show which key failed, and the model corrects its call in one retry. The TUI no longer shows a single todo failure the model fixed on its next call.

## 0.34.0

### Minor Changes

- b95928a: Size every request by the limit the provider actually enforces, and stop sending ones that cannot fit

  Sessions on routers (9Router, OpenRouter) and corporate proxies kept failing with `400 input length X exceeds the maximum allowed input length of Y tokens`: the catalog's context window was larger than what the provider behind the router enforced, so proactive compaction never fired, the request's own growth since the last step was never counted, and a router's envelope hid the upstream message from the overflow classifier.
  - A refusal that carries numbers teaches Redcode the provider's limit for that provider and model, along with how far the character estimate was off. Numbers that do not describe a refusal (a limit below 4,096 tokens or below a quarter of the configured context, a count that does not exceed the limit, sentences about images or tools) teach nothing. The lesson is kept in `model-limits.json` under the state directory, shared safely between processes, applied as the smaller of the catalog's limit and the provider's, raised when the provider later accepts a larger request, shown by `redcode debug limits` (`--forget` drops one), and cleared when `limit.context` or `limit.input` for the model is set or changed in configuration. The legacy runtime shows one toast per session when a limit is learned; the v2 runtime logs it.
  - Both runtimes preflight every provider request from the provider's count for the last step plus what history gained since. Over the limit, old tool output is trimmed or the history compacted before anything is sent. A request is refused without being sent only when the provider's own count puts it over a limit the provider itself taught and compaction has had its two chances in the turn; the legacy runtime measures that against the model's input limit, and after two refusals by the provider in one turn ends the turn with a clear message. A projection from the character estimate alone never refuses: the provider decides.
  - Router envelopes (`error.metadata.raw`, `Provider returned error`) and the codes `too_many_tokens`, `model_context_window_exceeded`, `input_too_long`, `prompt_too_long`, `max_prompt_tokens_exceeded`, `max_context_length_exceeded` and `context_window_exceeded` classify as context overflow on every adapter path, for HTTP 400, 413 and 422.
  - Router discovery reads `max_input_tokens` and OpenRouter's `top_provider` limits, and a model whose context nobody reports gets a guess held back by ten percent.

## 0.33.0

### Minor Changes

- e07a379: Turn a queued prompt into a steer without retyping it

  A prompt queued behind a running turn had to wait for that turn to end, even once it became clear it should reach the agent right away; the only way to steer was to type the direction again. A prompt still waiting in the inbox can now change how it is delivered: `POST /session/:sessionID/prompt/:messageID/delivery` with `{"delivery":"steer"}` promotes it at the running turn's next safe step boundary, and `{"delivery":"queue"}` sends a steer back to the queue. Only a pending prompt changes — one already promoted, or removed by a revert, answers 404 — and the change is a durable event, so every client's badge follows it.

  In the TUI, pressing the steer key (shift+return) or running `/steer` with an empty prompt while something is queued steers the most recent queued prompt instead of sending nothing; the command palette has "Steer queued prompt" for the same thing, and the busy footer says so while a prompt is waiting. The badge on the message changes from QUEUED to STEER.

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

- 2361df9: Name design review notes by where they are, not only by what they are

  A note left on an icon, a name shown in several places or a close button used to reach the chat as `svg`, `span "Filipe"` or `button "Close"`, and the agent guessed which one was meant. Every note is now labelled as a breadcrumb through its named ancestors, innermost first, such as `svg in button "Close" in dialog "New conversation"` or `span "Filipe" in li "Filipe" in aside "Conversations" (2 of 2)`, with a position only when several elements share the breadcrumb; a `data-design-id` or `id` on the element or an ancestor leads the label and the selector. Each note also carries a `Parent:` line naming the parent and grandparent with their XPaths, the transcript notice shows the same breadcrumb, and the review message asks the agent once to add a `data-design-id` when it edits an element referenced without one. The Design prompt now requires ids on every interactive element, icon-only button, landmark and repeated item.

- Updated dependencies [6d14532]
- Updated dependencies [db75a4d]
  - @reddb-io/redcode-schema@1.22.0
  - @reddb-io/redcode-client@1.18.23
  - @reddb-io/redcode-server@1.18.29
  - @reddb-io/redcode-tui@1.22.1
  - @reddb-io/redcode-design@0.0.2
  - @reddb-io/redcode-llm@1.19.1
  - @reddb-io/redcode-protocol@1.18.23

## 0.32.0

### Minor Changes

- d5a6ff6: Harden code mode. Calls a script makes now go through the same per-call policy as direct calls: PreExecute hooks, the loop guard, the tool deadline and permission asks. Scripts are limited to 50 tool calls, 120 s and 1 MB of output by default, their output is truncated through the tool output store, and attachments follow the direct path's MIME allowlist and size cap. Inputs to MCP tools are validated against the server's JSON Schema in both modes. Permission prompts from a script name the tool path with an args preview. Parallel asks for one tool are queued, and a rejection returns the results of completed calls. The catalog ranks read tools and tools already used first. Search returns compact matches. Syntax errors include line, column and a code frame, and flat tool names suggest the dotted path. Scripts can call `read`, `glob`, `grep` and `webfetch` under `tools.redcode`. `experimental.code_mode` (`enabled`: `off` | `auto` | `on`, `models`, `threshold`, `max_tool_calls`, `timeout_ms`, `max_output_bytes`) gates it per model. Code mode stays off by default.
- b25635a: Compaction in large windows and user control over it. The kept tail is a tenth of the usable window (8k to 60k tokens) and always includes the last turn. Old tool output is trimmed, on by default, when that alone brings the context under the limit (the summary is then skipped) or once the provider cache has expired; a trim is permanent, and the placeholder points the model at `session_history` instead of re-running the tool (`compaction.prune: false` turns it off). The summary request reuses the conversation's cached prefix where the provider supports it, is capped at 16k output tokens, and folds oversized histories in windows. Summaries end with code-built anchors (files, identifiers, the user's messages), and tools loaded through tool_search stay loaded. `/compact <focus>` steers the summary, and the new read-only `session_history` tool searches compacted-away messages.
- 28fc856: Connect 9Router directly from /connect: confirm the API URL (a missing scheme, a trailing /models and a bare host are accepted), paste the key, and pick a discovered model. The server saves the provider to global configuration and the key to the credential store in one call, sets model limits from the router, the models catalog or a conservative default so compaction keeps working, and removes previously discovered models the router no longer lists while keeping customized ones.
- d5a8af2: Design mode prototypes can now have several pages without hand-written show/hide code. Mark each page with `data-design-screen="id"` and `data-design-label="Name"` (inside a variant root or the page) and navigate with `data-design-go="id"`, `href="#id"` or `design.go("id")`; one screen shows at a time per variant, and a `design:screen` event reports each change. The review page shows a screen switcher that follows in-prototype navigation, review notes record the screen they were taken on and revealing a note opens it. Scenarios accept `screen`, so an audit opens that screen before its actions and reports screens it never rendered. `design_preview` and audits warn about duplicate, invalid or nested screen ids and `data-design-go` targets that do not exist. A small in-frame helper, `design.params.on`, `design.state` and `design.go`, wraps the params events and replays current values to components that mount late. The Design prompt now explains variants, screens, scenarios and params separately, with a short worked example, and the flow playbook covers multi-page apps.
- 2a30633: Add opt-in spend budgets for goals and sessions. Nothing is limited unless you set a limit: there is no default cost or token budget, no budget warning without a budget, and the model cannot set one.

  Every finished provider step is counted: the turn itself, subagents, compaction, session titles and the goal judge. The running total is stored on the session (`metadata.spend`) and rolls up to parent sessions. Token limits count input, output, reasoning, cache writes and cache reads. An attempt that is aborted or fails before the provider reports usage is not counted, so spend can be slightly under the bill.
  - **Goals** accept `max cost: $2` and `max tokens: 500k` in the `/goal` text, `max_cost_usd` and `max_tokens` on `POST /session/:id/goal`, and a spend change through `/goal-budget` (for example `$3`, `500k tokens`, `40 turns $3` or `off`).
    - When a goal reaches its budget, it pauses after the current step with a reason such as `budget: $2.00 of $2.00 spent`.
    - Resuming stays paused while the goal's or the session's budget is reached; the resumed turn is told the budget was hit and asks you before spending past it.
    - A spend line that cannot be read stays in the objective and the response warns about it. A goal made only of spend lines is refused: it needs an objective.
  - **Sessions** read `session.budget` (`max_cost_usd`, `max_tokens`, `reset_on_message`) from the global or project configuration. You can override it per session, including `reset_on_message`, with `/budget $5`, `POST /session/:id/budget` or `redcode run --max-cost` / `--max-tokens`.
    - When the budget is reached, the turn finishes its current step and stops; the reason is shown in the transcript as a notice that is never sent to the model.
    - No provider is called again until the budget is raised. With `reset_on_message: true` the budget counts afresh from each message you send instead.
    - `redcode run` exits 1 whenever a budget stopped it, whether the limit came from the flags, the configuration, the session or a goal. A fork starts its own spend and keeps the limits.
  - **Amounts:** `2,50` is 2.50, `1,000` is a thousand, and `1,5m` is 1.5 million tokens; mixed separators such as `1.000,50` are refused with a message.
  - **Pricing:** a model priced at zero is free. A model with no pricing data makes its cost unknown: a cost limit warns once, the known cost still counts, and a token limit bounds the rest.
  - **TUI:** under "$ spent", the sidebar shows spend against a budget, labelled as including subagents, but only when a budget is set. You get one warning at 80% of a limit, and a notice when a budget stops a turn or pauses a goal.

- 4636b64: Session monitors can now wait on an HTTP endpoint, a file or a process natively, without a shell and on every platform: call the `monitor` tool with `action: "probe"` and an `http` probe (status, `json_path` with `equals`/`contains`/`regex`, same-host redirects only, 1 MB and 10 s bounds, `{env:NAME}` header values that ask a separate `env` permission per variable and host and are never shown), a `file` probe (`exists`, `missing` or `changed`, with `min_size`) or a `process` probe (`running` or `exited`, by exact executable `name`, by command line with `match: "cmdline"`, or by `pid`, among the current user's processes). Regular expressions run in a worker with a hard timeout, so a catastrophic pattern cannot freeze the runtime. An http probe asks the `webfetch` permission, a file probe asks `read` and `external_directory` (symlink targets included), and a process probe needs none; a poll longer than 10 minutes is still approved every time. Command polls gain `success_regex`, `failure_regex` and `until: "changed"`. Poll checks are now spread by a small random jitter (`jitter: false` keeps exact intervals), the last check always starts before the deadline, and a finished monitor's resume message states what matched. The sleep-polling guard offers the matching probe for `curl -f`, `test -f`/`[ -e ]` and `pgrep` loops, and `/monitors` shows probe monitors with their schedule.
- 92e03f2: Use the provider's own tool search for deferred MCP and Design tools where the model supports it. On Anthropic (Claude 4.5 and later on the Anthropic API) every deferred tool is sent with `defer_loading` next to the BM25 tool search tool, in both the AI SDK and the native runtime. On OpenAI Responses (GPT-5.4 and later, AI SDK runtime) deferred tools are sent as deferred functions grouped in one namespace per MCP server, next to the hosted `tool_search`. The provider loads matches without touching the cached prefix, so a step that loads a tool no longer re-bills the system prompt and history. Other providers keep the client-side `tool_search`. Search calls persist, replay on the next request, and show as a compact "Tool search" row in the TUI. If a provider rejects the request with a 400 about the search tool or deferral, the step is retried once with `tool_search`, native search stays off for that model for the rest of the process, and a warning is logged. Configure with `experimental.tool_search.native` (`"auto" | true | false`).
- 58b3832: TUI steering: enter sends a prompt queued behind the running turn, and while the agent works shift+return (`input_steer`) or `/steer <text>` steers it instead — the direction reaches the agent at its next step without interrupting the running tool. On an idle session shift+return still inserts a newline, and a config that puts the steer key on `input_newline` keeps it a newline. Pending steers show a STEER badge, promoted ones are marked as steered, and the busy footer hints both keys. A queued prompt now runs before a todo continuation or goal continuation instead of waiting for the goal to finish; the goal stays active and resumes afterwards.
- eccb4a9: Bring the v2 session runner behind `redcode design` to parity with the legacy runtime. Retries now follow the legacy policy: at most 5, with exponential backoff and jitter, `retry-after` honoured, and no retry after a context overflow or once a local tool has run. The v2 runner also gains:
  - the loop guard, which corrects a repeated identical tool call and then stops it, pausing an active goal with a `loop guard:` reason;
  - the 10-minute tool deadline, which does not count time spent waiting on a person;
  - live `session.status` busy, retry and idle events;
  - the stall watchdog, which ends unattended turns after 10 minutes without output.

  MCP tools in v2 are now registered as `<server>_<tool>`, the same key legacy uses, instead of `mcp_<server>_<tool>`. Permission rules or hooks that named v2 MCP tools with the `mcp_` prefix must drop it. Config load logs a warning for any such rule and leaves it unchanged. Tool calls already in existing v2 transcripts keep their old names and are only replayed as history.

  Two safeguards come with the shorter names:
  - A built-in tool always wins over an MCP or plugin tool of the same name, and the collision is logged. A server named `design` can no longer replace `design_preview`.
  - An external tool is allowed only by a rule that names it exactly, or by `*`. A built-in family pattern such as `design_*` no longer auto-allows it.

### Patch Changes

- 841a697: Close tool calls left without a result by a cancelled or interrupted turn:
  - **Synthetic result:** every call without a result is sent as failed, with a message saying it was cancelled or interrupted and its outcome is unknown. Up to 2,000 characters of the output it produced before stopping are included. Partial output is no longer passed off as a successful result.
  - **Crash repair:** when a session is loaded after the process died, tool calls it left running or pending are marked interrupted, not only the open message.
  - **Failed steps:** a step that failed after one of its tools ran stays in history, so the model does not repeat that side effect.
  - **Cancel note:** the turn after a cancel gets a single trailing reminder saying so. It asks the model to check state before repeating side effects and not to redo completed work, and it keeps the cached prefix stable.
  - **v2 runner:** the same result text and note apply there, and a history loaded without repair still pairs every call with a result.

- d80884d: Stop the compaction cycle near the context limit. A large pasted request no longer makes every summary look like it "did not reduce context": the latest request is left out of that check, and when it exceeds the recent-history budget it is kept as a bounded head and tail with a `[middle elided: N tokens]` marker and the full text saved where the model can read it. A compaction now counts as effective only when the next request (system prompt, tools, summary and recent history) fits in 80% of the usable window. Effective compactions are never capped; two ineffective ones in a row within a turn pause automatic compaction until the next message or `/compact`. The pause is stored on the session, and the turn ends with one warning notice instead of looping; a paused goal resumes with guidance about keeping the context small. A turn that already gave its final answer is no longer revived after compaction; the continuation is added only mid-work or when steered messages are waiting, and says explicitly what to do. The goal judge grades the real answer, never the summary. The TUI shows "Compacting the conversation" while a compaction runs and the token count before and after on the divider, and an overflow that compaction recovers no longer shows as an error. Unattended runs (scripts, ACP, goal mode) get one wrap-up reminder when less than 5% of the usable context is left; attended sessions get none.
- e99fd6b: Design review notes now point at exactly one element. Each note carries a selector that resolves to only the clicked element, an XPath and the surrounding containers, and its label uses the element's label, placeholder or position (for example `input[type=text] (2 of 3 inputs in section "Filters")`) instead of a bare `input`. Design agents are asked to give reviewable elements a stable `data-design-id`.
- 207ffdf: Design handoffs now evolve existing product code instead of replacing it with the prototype. A design records the product files it redesigns (`targets`), and the approved context given to Plan and Build states that the prototype is a reference, lists those files and requires an incremental migration that keeps the real data layer, current behaviors and existing tests.
- 59d32f0: Publish npm packages through npm trusted publishing (OIDC) instead of a 2FA-bypass token, and publish the GitHub Release once its binaries are uploaded, smoke-tested, and handed to the npm job, so an npm failure no longer holds back mise installs. Reruns and `npm_only` runs for an already published tag unpack the npm packages from the checksum-verified release assets instead of rebuilding them. When npm stages a version for maintainer approval instead of publishing it, the release job now names the staged packages and the approval steps instead of reporting registry lag.
- 6c299c7: The sleep-polling guard now refuses wait loops around local checks, such as `until grep -q PASSED ci.log; do sleep 5; done`, when their total wait is 30 s or more or cannot be read off the command. Before, it only caught loops around remote status commands. The refusal suggests polling the check itself: every 1–2 s with a 2-minute deadline for an open-ended readiness loop, done when it exits 0, and it names any commands that came after the wait. A `while` condition is inverted so that exit 0 still means done. Batch loops that act on each item, and retries bounded under 30 s by a counter, an iteration count or `timeout`, still run.
- 8e60b48: Stop config loading from trying to install the unpublished `@reddb-io/redcode-plugin` package, which logged a 404 on every run. Config directories now only install dependencies they declare in their own `package.json`. Retry status no longer shows OpenCode Go upsell messages or opencode.ai links; usage-limit errors show the provider's own message.
- ad01081: todowrite no longer refuses a task update because a requirement or scope-change quote does not match a user message: a matching quote links its message, anything else is linked to the latest user request with the model's wording kept, and the tool result says so. Completion still requires real verification, and cancellation still requires a scope change and a concrete reason. New `redcode debug todos [sessionID]` prints a session's tasks with their source, criterion, evidence, revision and refused attempts, plus the latest todowrite errors (`--json` for machine output).
- 6282295: Fix the TUI starting without agents or commands behind repeated HTTP 499s: a cancelled request no longer poisons the per-instance cache, bootstrap re-runs are coalesced instead of cancelling each other, and client cancels are logged at debug.
- Updated dependencies [4636b64]
- Updated dependencies [92e03f2]
  - @reddb-io/redcode-schema@1.21.0
  - @reddb-io/redcode-tui@1.22.0
  - @reddb-io/redcode-llm@1.19.0
  - @reddb-io/redcode-client@1.18.22
  - @reddb-io/redcode-design@0.0.1
  - @reddb-io/redcode-protocol@1.18.22
  - @reddb-io/redcode-server@1.18.28

## 0.31.2

### Patch Changes

- 73dcaa8: Make the release publish step safe to rerun while npm registry reads lag: an E409 republish conflict counts as already published, platform packages must be visible before `@reddb-io/redcode` is published, and the smoke step waits for every package and names the ones still missing.

## 0.31.1

### Patch Changes

- 0f0bee0: Keep the models catalog working on networks that block `models.opencode.ai`. Redcode now tries `REDCODE_MODELS_URL`, then the new global `models.sources` config list, then `https://models.opencode.ai/api.json` and `https://models.dev/api.json`, and falls back to the disk cache or the catalog bundled into the release. A source that answers 401, 403, 407 or 451, fails with a proxy or TLS error, or returns a page that is not a catalog is skipped for 1h, then 6h, then 24h. The backoff is persisted, so restarts don't retry it, and the source logs one warning instead of an error every refresh. A block page never replaces a good cache, and `models-dev.refreshed` is emitted only when the catalog changes. `redcode models --verbose` prints the catalog origin, age and blocked sources. Release builds now fail when no source yields a valid catalog, instead of embedding whatever the request returned.
- ae2b008: Stop `todowrite` from failing over and over in fresh sessions. The task gate now reads a legacy session's user requests and tool results even after the session gains a projected context update or agent switch, which used to hide all of them. A requirement that retypes the request with different whitespace, quote marks, accents, case or an ellipsis matches it, and a paraphrase attaches the latest request and keeps the wording as the criterion. Completing a task still requires real evidence. Refusals now say how to fix the call, are logged at WARN with their kind, and the folded "Todo update failed" row shows the latest error, expands to every error in the run and copies them.
- 7b49f6b: Make `apply_patch` transactional:
  - **Staging:** every hunk is staged in memory against the current file contents, so later hunks see earlier ones, including updates to a file moved earlier in the same patch.
  - **Checks:** permission, repository and external-directory checks run on every path with symlinks resolved, including move sources and destinations, deletes, and new files under a linked directory. Nothing touches disk until every path is verified and approved.
  - **Writes:** each file is written atomically through an exclusive temp file created with the target's mode, keeping its mode and symlinks.
  - **Failures:** a patch fails without writing if a file changed while approval was pending, or if two paths resolve to the same file. A failure midway rolls back the files already written, restoring deleted symlinks as symlinks, and the error lists what was rolled back and anything that could not be.
  - **Permission diff:** it shows when an added or moved file replaces an existing one.
  - **Line endings:** each line keeps its own ending, new lines use the file's dominant ending, and a missing trailing newline is preserved.

## 0.31.0

### Minor Changes

- 0a5b474: Defer MCP tools behind a new `tool_search` tool once their schemas exceed about 3000 tokens, and defer `design_*` tools outside a Design context. The system context lists deferred tools by name, grouped by server. A search or an exact `select` loads them for the rest of the session, and calling a listed tool directly still works. Loaded tools are advertised after every other tool in the order they were loaded, and a server that connects mid-session reaches the model as one system update, so the cached tools block stays intact. Five connected MCP servers drop the first request from about 31k to 11k tokens. Configure with `experimental.tool_search` (`enabled: "auto" | true | false`, `threshold`).

### Patch Changes

- 7405d9a: Fix every prompt in a session failing with "Unexpected server error" once a completed task's quoted user message was no longer in the session history (for example after compaction). The task review that runs before each provider step re-validated the task's stored request and failed the whole prompt. A stored request is now trusted, and a task review the store refuses is logged and keeps the stored list instead of failing the turn.
- 7621dc8: Keep the provider prompt cache warm across steps, turns and MCP connects.
  - Tools are advertised in fixed blocks: native tools sorted by name, MCP resource tools, `tool_search`, directly advertised MCP tools, then tools activated through `tool_search` in activation order. MCP servers keep a durable order (config order, then first-seen) that survives restarts, reconnects and connection timing, so a server connecting mid-session appends its tools instead of interleaving them by name.
  - Per-step reminders (task state, goal, plan and design context) travel in a trailing `<system-reminder>` message instead of being appended to the last user prompt, so earlier turns stay byte-identical. Cache breakpoints skip that message. Plugins using `experimental.chat.messages.transform` or the Agent PreStep hook no longer see these reminder parts in the step's messages.
  - Calling an unknown tool returns a message of at most 300 bytes naming the closest tools instead of listing every tool.

- ef04f6c: The v2 core `bash` tool (used by `redcode design`) now refuses sleep polling loops, blocking watchers and long sleeps before asking or running. Without monitors in v2, the refusal offers a single status check to run now and report, or a bounded wait under 30 s. The detector moved to `@reddb-io/redcode-core/tool/shell-polling` and the legacy shell tool uses it unchanged.
  - @reddb-io/redcode-client@1.18.21
  - @reddb-io/redcode-server@1.18.27
  - @reddb-io/redcode-tui@1.21.3

## 0.30.0

### Minor Changes

- 87af685: Design mode detects the project's design system and offers to adopt it. When no `design.system` is configured, `redcode design`, and `design_document` create or refresh in the TUI and V2 sessions, ask once "Use detected design system?" with the detected component roots, global stylesheet, Tailwind version and config, framework and tsconfig aliases, each with its confidence. Monorepos target the application package, and an opened directory that is itself an application wins. Detection only reads files inside the project and never runs project code. Yes writes the `design` section into the project config file that already supplies `design` (keeping other keys, comments and indentation) once the design was created, confirms the configuration now carries it, and generates `.red/DESIGN.md`. No is remembered for the project in user state, and Edit later asks again after a day. `design_document {"action":"detect"}` reports the detection and its evidence without asking. The new `design.browser` setting chooses the browser for review pages (`REDCODE_DESIGN_BROWSER` still wins), `design.application` names the package a design targets by default, and `design` settings now merge key by key, so a global `design.browser` survives a project `design.system`.
- 3fc370f: Add session monitors for one-shot shell commands and periodic observation of external jobs. Release the chat while work continues, persist status and bounded evidence, resume the originating session with a synthetic result, and inspect or cancel monitors from `/monitors`. Waiting suspends automatic task/goal nudges without consuming provider calls; cancellation suppresses continuation and restart never replays a command.

### Patch Changes

- 9c457a1: Scope OpenTUI's runtime-module rewrite to TUI plugin modules. Host source loaded after a TUI plugin, such as the design store's React scaffold, no longer has bare `from "…"` specifiers rewritten into file URLs from the plugin's install, which on hoisted (Windows) installs sent design builds outside the application and stalled them on an `external_directory` prompt.
- 9cfacdb: Design system detection no longer remembers "nothing detected" when it ran out of time, and a scan cut short is reported with at most 50% confidence. A design system one session adopted stays with that session until it is saved, so another session's failed design no longer takes it away. `design_document {"action":"detect"}` states that it only reads project files and never asks or writes, and the docs explain how `design.application` combines with `design.system` across config files.
- 0078f63: Show the MCP OAuth authorization URL in the web and desktop app when the browser cannot be opened, with open and copy actions.

## 0.29.0

### Minor Changes

- 8fd1ed7: Design review: delete, rename, reorder, merge and split variants from the variant strip. Each operation is sent to the agent as structured feedback and shows in the preview at once (hidden, relabelled or reordered variants; merging and splitting tabs are marked) until the agent's new revision replaces it; a failed request or a turn that ends without the change reverts the view and keeps the request for a retry. Notes on a removed variant can be retargeted, and the terminal and TUI transcript name the requested operation.

### Patch Changes

- bb1fd8a: Design review opens at most one browser tab per review. The Design tool, the TUI's Open Design review and `redcode design` all claim the launch through the server, which counts connected review pages (including an open app review panel): a publish while a page is connected opens nothing and the page live-reloads, rapid publishes or a publish right after an explicit open open one tab, a failed launch is retried on the next publish, and a closed tab is reopened only after a short debounce. The tool result says whether a tab was requested instead of claiming one opened. `REDCODE_NO_BROWSER` now stops every browser launch (Design review, MCP OAuth, account login, plugin OAuth), and test suites set it.
- 108cda3: Plan approval no longer leaves an unanswerable dialog. When the server no longer has a question (its turn was interrupted, or the instance reloaded), answering or dismissing it now removes the dialog and says why. Before, the failure was silently ignored, so Enter, Esc and Ctrl+C all appeared to do nothing and the only way out was to kill the terminal. The v2 runtime now also tells clients when a pending question ends without an answer.
- 4ec7a88: Question and permission dialogs are easier to get out of when the server is slow or failing.
  - **Slow replies:** if the server doesn't take a reply within 10 seconds (30 seconds for a remote server), the TUI checks whether the request is still pending. If it is, the dialog stays open and says it is still waiting. If not, the dialog closes and warns that your answer may still be applied.
  - **Errors:** a request that no longer exists closes the dialog. Any other error keeps it open so you can try again.
  - **Ctrl+C:** pressing it twice on the same dialog within 5 seconds exits, even while a dismiss is still pending. Dismissing one dialog never makes the next one exit.
  - **Plan approval:** time spent reading a plan approval or answering a permission prompt no longer counts against the tool deadline. Before, a long read stopped plan_exit and left the approval dialog stale. Waits are tracked per session, so a subagent that reuses a provider's call ID doesn't affect its parent.

## 0.28.0

### Minor Changes

- 3580706: Design mode reuses the project's design system in preview builds. A new `design.system` section in `redcode.json` declares the component and token roots (`paths`), the stylesheets every preview includes (`css`), whether to run the project's Tailwind/PostCSS pipeline (`tailwind`, on by default when `tailwind.config.*` exists and tailwindcss is a dependency), the component `framework` and extra import `aliases`; the effective values are recorded on each design document as `system`. Declaring a root is a standing read grant for design builds: `design_preview` asks once for the declared roots, stylesheets, tooling configuration and `node_modules`, and later previews import from them without a prompt per file, while undeclared files still prompt, symlinks escaping a root stay refused and packages linked from a source tree outside `node_modules` must be declared. Running the project's Tailwind/PostCSS configuration is a separate `project_tooling` permission; when refused the preview is built without it and the result says so. Builds now forward the project tsconfig's JSX and class-field settings, honour every `paths` target, resolve dependencies through the original checkout when the design lives in a linked worktree without `node_modules`, and link or import the declared stylesheets in html, react and solid previews.
- 71d219c: Design mode reuses the project's design system context. Discovery now also finds component barrels (`src/components`, `src/design-system`, `packages/*/src`), Storybook and PostCSS configuration, the design-relevant slice of `package.json` and story files (names only), keeping provenance hashes and a deterministic 60-source cap. A static component inventory lists the exported components per root, `.red/DESIGN.md` is generated in the application root when missing and its marked block is regenerated by `design_document refresh` while the Notes section and anything outside the markers stay verbatim, and `design_document` in both runtimes renders a Design system block (authoritative docs, token files, CSS pipeline, component inventory, configured system) so the agent imports real components and tokens instead of re-implementing them.

### Patch Changes

- 6f224ec: Annotation moved to the review toolbar with an A shortcut
- f354500: Compact the Design review header into two rows: one toolbar with the design and revision selects, the status pill, preview width and approve, plus a "More actions" overflow menu for the rarely used actions; and a variant strip with icon buttons for adding a variant and switching between single and side-by-side views. "Restore as new revision" now appears only while browsing an older revision, every control keeps its accessible name, and the rows wrap on narrow screens.
- bc33a95: Design review pages open in Chrome or Chromium when installed; set REDCODE_DESIGN_BROWSER=default to use the system browser.
- 29584cc: Task completion no longer loops on the evidence gate, and the gate stays strict. When `todowrite` completes a task without `evidence`, only a verification result is recorded on the model's behalf: a successful `bash`/`shell` check (exit 0), `design_preview` or `design_export` after the request and newer than the last edit touching its files; edits, reads and other results are never selected, and the tool output says which result was used. Cited evidence is judged on its own: a failed, unknown, ambiguous, pre-request, bookkeeping, abandoned or superseded result, or an edit cited as its own proof, is refused with that specific reason and no other result is substituted. Investigation tasks may cite the `read`, `grep` or other result that answers them, with an explanation. Commands run after the proof never invalidate it; a later edit does, including `design_edit`, `design_generate` and `design_asset`, and an edit still streaming in the same assistant message as the `todowrite` is not held against it. Tool calls left pending in an assistant message closed by a crash or abort are treated as settled failures, so they neither invalidate evidence nor reopen completed tasks. Refusals list the recent callIDs, tools, kinds and messageIDs inline. Updates may address a task by `id` and `revision` alone, `text`, `title` and `task` (also alongside an empty `content`) fold into `content`, and a malformed update quotes the missing keys with a minimal correct example. After two genuine evidence refusals for one task in a turn the task is blocked with that reason; malformed calls and loop-guard corrections do not count. The loop guard notices repeated identical `todowrite` failures across drifting arguments and only corrects, never stops, for them; other tools are unaffected. The TUI folds consecutive failed `todowrite` calls, across assistant messages, into one "Todo update failed ×N" row that keeps its expanded state while the run grows.
- ec7fe5b: Harden the todo evidence gate for the TUI runtime: a shell check is recorded on the model's behalf only when the task says what it had to show, and the note quotes its command; relative paths are compared against the session directory; design edits only reopen tasks proven by the same design; a turn whose todowrite calls keep failing now stops after eight; and the TUI folds failed todowrite runs without rescanning finished messages on every streamed token.
- e49d61c: Polish the todo evidence gate. A goal paused by the loop guard now shows a short reason instead of the model's instructions, and a repeated identical call pauses it too. The read-only command check now sees through `bash -c` and subshells, skips `git -C`, accepts `sed -n`, and ignores a quoted `>`. Windows paths are compared case-insensitively, with drive letters and UNC roots respected. The TUI fold notices any todowrite part that settles late.

## 0.27.0

### Minor Changes

- 7524b87: The design review page annotates elements in place: with "Annotate elements" on, clicking an element in the preview opens a note card over it, in the review page rather than inside the sandboxed prototype, headed by the element's tag and text. Enter queues the note, Shift+Enter breaks the line, Ctrl/Cmd+Enter queues it and sends the review, and Escape closes an empty card or hands focus back; an unfinished card survives a reload. The notes list shows each note's element label with Reveal (scrolls the prototype to the element and pulses it) and Remove, and hovering a note highlights its element. Feedback goes out with two buttons, "Send to agent" and "Send & end", replacing the delivery and end checkboxes; Ctrl/Cmd+Enter in the composer sends. Layout observations from the prototype's audit move out of Details into a collapsible inbox under the notes, with a severity tag, Reveal and Dismiss per finding and a count badge; ticked findings become notes in one "Queue selected fixes" step, findings a newer revision no longer reports resolve themselves while ones it still reports reopen, and dismissals are remembered per design on the device.
- 69d35a3: The design review page now carries the conversation: agent replies, tool activity and the working state stream into a Conversation panel next to your notes (in both `redcode design` and the TUI's review page), your sent feedback is echoed as "You: N notes", and a newly published revision reloads the preview in place while you are on the latest one, keeping your scroll position, selected variants and unsent notes; while browsing history the "New revision available" button stays.

### Patch Changes

- 51b1b33: Design review feedback now reaches the agent as one bounded `<design-review>` message: the user's note, the selected element's label and selector, selected or element text, and the scenario parameters are separate labelled fields instead of one fused blob, the page-text snapshot stays out of the message and is readable on demand with `design_read` section `snapshot`, and the TUI and `redcode design` terminal show the review as a compact list of notes with attachment chips instead of the raw text.
- e5a5e67: Legacy sessions now bound oversized tool output through core's `ToolOutputStore` instead of the runtime's own `Truncate` service, so both runtimes share one Managed Tool Output directory, one file naming scheme, one head-and-tail bounding policy and one retention scan. The model-visible notice is the store's `... output truncated; full content saved to <path> ...` between the head and the tail of the output, followed by the instruction to Grep or Read the saved file with offset/limit rather than whole; the previous Task-tool delegation hint is gone. Limits still come from `tool_output` in Redcode config, the managed directory stays readable for every agent, and a storage failure still yields a lossy bounded output without a path (warning logged) rather than a failed tool call, now for streamed shell output too. Managed files are still deleted by age after seven days.

## 0.26.3

### Patch Changes

- 8f12547: Keep the system prompt stable across the steps of a turn

  The legacy session loop rebuilt the whole system prompt before every provider
  call, so an edited AGENTS.md, a changed skill list or a new day rewrote the
  cached prefix mid-turn. The loop now stores one Baseline System Context per
  Context Epoch and reuses it verbatim; changes are admitted once as a
  `<system_update>` message at the next safe boundary, and compaction or a revert
  starts a new epoch.

- a9d5d07: After a legacy compaction the context epoch is replaced with `SystemContext.replace` semantics instead of being reset: the request is durable on the epoch row, a source that is temporarily unavailable at the boundary keeps the previous baseline and snapshot in force while the turn proceeds, and the replacement is retried at every later boundary until it succeeds.
- a3d588f: Legacy sessions admit prompts into the durable inbox before they become model-visible: a prompt sent while a turn is running is promoted at the next safe step boundary (`delivery: "steer"`, the default) or only once the session would otherwise go idle (`delivery: "queue"`), one at a time in admission order.

## 0.26.2

### Patch Changes

- 15a6d1f: Answer prompts that land while the previous turn is finishing

  A prompt that arrived after the running turn's last look at history but before
  the session went idle was persisted and never answered. The session runner now
  records work that arrives during a run and starts one more run before going
  idle, so the trailing user message gets its reply. A cancel still drops that
  pending work instead of restarting it.

- ea93d05: Count goal turns as judged turns and never leave a goal active on an idle session

  A goal turn is now one full agent turn ending in a judge cycle. Tool round-trips
  inside a turn and provider retries under it no longer spend the budget, so the
  default of 20 turns is no longer exhausted by a turn that reads fifteen files; a
  turn parked on background work spends nothing until its report is judged. The
  goal block, the continuation, the judge prompt, the budget dialog and the toasts
  all say "turns".

  A `/goal-budget` or `/goal-resume` landing while the judge decides is no longer
  lost: the decision is taken again on the fresh record, and a second loss pauses
  the goal with a reason. The step ceiling and the stall watchdog now pause the
  goal with their reason instead of leaving it active with nothing recorded.
  Evidence for the judge is scoped to the current turn, and gate results survive
  the cut ahead of tool output.

- bfff62d: Keep a Design param field you are editing from being overwritten by the prototype

  The Params panel re-synchronises its fields whenever the prototype reports its
  state. That report arrives asynchronously, so a value typed right after a click
  in the preview could be replaced before it was applied and the edit was lost.
  A focused field now keeps the typed value until its change event fires.

- 0bc8b09: Discard a failed provider attempt's parts before retrying and never retry past an executed tool

  When a stream failed with a retryable error, the parts it had already persisted (text,
  reasoning, step-start, tool parts) stayed in the assistant message and the retried stream
  appended duplicates next to them. The processor now removes what the failed attempt wrote
  as soon as a retry is decided, so the message holds one copy of the answer. A failure after a
  tool call already ran is no longer retried at all: replaying the request would execute the
  tool a second time, so the error is surfaced as a normal terminal failure instead.

- 3c3ee73: Refuse task_id values that do not descend from the calling session

  The task tool now walks the resumed session's parent chain and requires the
  calling session to appear in it, so a model can no longer prompt into a sibling
  or another project's session by passing its id. The subagent depth cap is
  computed on the chain that is actually prompted, and the background cap counts
  only background jobs instead of every running task.

- b300c3a: Keep todo state out of the system prompt so todowrite preserves the provider cache

  The session loop rendered the live task list into the system prompt on every
  step, so each `todowrite` rewrote the prompt and invalidated the provider's
  cached prefix for the request that followed. The task state now rides the last
  user message as a reminder, the way the goal already does, with the same text;
  the system prompt keeps only the static todo guidance. The list is reviewed
  once per step instead of twice.

- 657200b: Stop the tool a deadline fires on, and keep truncated output when its file cannot be written

  A tool that outlives its deadline is now handed an aborted `ctx.abort`, joined
  to the turn's own signal, so tools that honour it actually end instead of
  running on after the model was told they failed. Truncated tool output whose
  full text cannot be retained (unwritable directory, full disk) is now returned
  as a bounded, explicitly lossy result without an output path, and the storage
  failure is logged, instead of failing a tool call that had already succeeded.

- 10c6faa: Verify the whiteboard bundle against the release SHA256SUMS before unpacking it

  The Design whiteboard tarball fetched from GitHub Releases is now checked
  against the `SHA256SUMS` published with the same release: a missing entry or
  a mismatched digest refuses to unpack and surfaces as a clear `unavailable`
  error instead of installing whatever came down the wire. Both downloads carry
  a 60 s timeout, a failing `tar` reports its exit code and stderr, and an
  archive without `whiteboard.js` is rejected before it can be renamed into the
  cached release directory.

- 5778f0f: Unpack the whiteboard bundle on Windows when GNU tar is first on PATH

  GNU tar reads a drive letter such as `C:` as a remote host, so extracting the
  bundle by absolute path failed with exit code 2 on machines where Git's tar
  shadows the system one. The installer now runs tar inside the release
  directory with relative names only.

## 0.26.1

### Patch Changes

- 887d171: Reject stale plan-exit question dialogs instead of freezing on them

  When the tool asking a question is interrupted, the pending request is now
  published as `question.rejected` so clients drop the dialog. The TUI question
  prompt surfaces reply/reject failures with a toast and removes the stale
  request instead of silently swallowing them and leaving a dead dialog.

## 0.26.0

### Minor Changes

- 970b54d: Add a Params tab to Design for live component controls, bidirectional prototype state, named scenarios, reset and component picking. Persist scenarios in revisions, capture parameter context with review notes, and exercise declared parameters in rendered audits and comparisons. Guide Design agents to build functional wizard, modal and outcome simulations automatically.

  Use the official RedDB favicon and vendor the compiled Application theme and token CSS from Design System v2026.08.5 for the shared Design review.

## 0.25.2

### Patch Changes

- 40204c7: Prepare context summaries in the background near the compaction threshold in both runtimes. Reuse validated candidates between provider turns, retain messages added during preparation, discard stale candidates, and cancel auxiliary work when execution ends. Add `compaction.background` to disable preparation independently of automatic compaction.
- 99c8158: Preserve the latest original user request across repeated context compactions in both runtimes. Reject unfinished, truncated, empty or non-shrinking summaries before they replace active history, and keep legacy history visible until checkpoint validation completes. Share summary instructions that preserve user constraints, approval scope and verified work state.

## 0.25.1

### Patch Changes

- d6f3685: Report preview assembly failures from the TUI Design server as actionable errors instead of opaque HTTP 500 responses. Show the failure in the preview canvas, disable actions against a failed preview, stop repeated polling retries, and retain the selected revision when explicitly retrying with Refresh.
- d6f3685: Preserve requested tasks across partial updates in both session runtimes. Add stable task IDs, revisions, change history, automatic next-task selection and explicit reasons for blocked or cancelled work. Reject conflicting stale updates, show blockers in the TUI, and preserve unfinished work when continuation attempts are exhausted instead of silently abandoning it.
- d6f3685: Connect approved Plan revisions to persistent execution tasks in both runtimes. Restore task state across continuation and compaction, require actual tool evidence for tracked completion, preserve scope changes, and pause continuation budgets without converting remaining work into blockers.

## 0.25.0

### Minor Changes

- a541de5: Integrate frontend quality review into Design: two bounded correction cycles, evidence-based anti-slop guidance, per-variant and scenario audits, persisted screenshot manifests and actionable findings in both runtime tool responses. Preserve human approval and report incomplete verification explicitly.
- 3793912: Require repository preflight and linked worktrees for native source edits, guard destructive Git commands while allowing normal pushes, and prepare Design prototype worktrees automatically. Separate unrestricted local --yolo execution from --auto, with an explicit TUI indicator. Validate shell working directories before execution and provide bounded recovery guidance for invalid repeated paths. Disable stale Design approval immediately when a newer revision arrives, before loading assets.

## 0.24.0

### Minor Changes

- 83a88a9: Persist selected Design variants and immutable approval context across Plan, Build, resume and compaction. Replace large chat handoffs with a compact approval notice, automatically supplied requirements, and a read-only tool for detailed evidence and prototype files.

### Patch Changes

- b3a0688: Make Design review actions show progress, persistent errors and approval confirmation; reload the preview on Refresh. Add variant tabs, side-by-side comparison, named device widths and prompt-driven requests for new or separated variants. Keep long plan approval questions scrollable in the TUI so answers and keyboard controls remain visible.
- f2c7b00: Fix Plan-to-Build handoff: always identify and allow the session plan file, recognize canonical Windows plan paths, report missing or unreadable plans with actionable errors, and persist Build mode after the user approves the recorded plan. Product editing remains gated by that approval.

## 0.23.4

### Patch Changes

- c5dcd0a: Expose Design preview arguments as an object schema compatible with model tool calling, while preserving validation of current IDs and legacy prototype paths. Return the exact preview call with each design document and explain how to recover missing arguments instead of repeating an empty call.

## 0.23.3

### Patch Changes

- 8d0e560: Preserve explicit Amazon Bedrock model ARNs and DeepSeek V3.2 IDs, while retaining regional inference prefixes for DeepSeek R1 in both Core and the CLI.
- 8d0e560: Update the GitLab provider to 6.15.0 in Core and the CLI, adding GPT-6 Astra model mappings with Responses API routing.
- 915cb15: Reload individual MCP servers or all configured MCPs from /mcps without closing the session. Reread configuration, refresh tools and resources, preserve manual enable/disable choices, and report failures in the dialog.

## 0.23.2

### Patch Changes

- 0643f90: Expose design_document arguments as a provider-compatible object with a required action and explicit usage guidance, while preserving validation of each operation.
- 0643f90: Add /design-open to search existing Design conversations in the current workspace and resume their history from a session picker.

  Document the complete Design-to-review-to-implementation workflow, command availability, and the differences between the regular TUI and optional Design terminal.

## 0.23.1

### Patch Changes

- 292ec67: Open a fresh empty session directly for /new and /clear instead of returning to the welcome screen.
- 292ec67: Remove the ASCII art banner from the upgrade command.
- 58f05c5: Add `redcode usage backfill` to mirror historical session usage into usage reports, with repeatable imports and JSON output, and `redcode usage path` to show mirror destinations.

## 0.23.0

### Minor Changes

- 5ce06f9: Restore Design as the cyan third mode in the fullscreen TUI, alongside Build and Plan. Keep prototyping, browser feedback, image assets, SVG-to-GIF exports and approved Plan handoffs attached to the same conversation. Reopen pre-0.22 prototypes without overwriting their sources, and retain the new Design revision and rendering services. Queued browser feedback respects session interruption and requires an explicit retry to resume.

### Patch Changes

- 5ce06f9: Restore a compact Design review surface with cyan actions, system light/dark themes, a viewport-sized preview, and keyboard-accessible Review, Assets and Details panels. Keep control styles inside Shadow DOM and prototype styles inside their sandboxed iframe, without adding Tailwind or a global reset.
- 5ce06f9: Fix LSP recovery from rejected NODE_OPTIONS, including Biome startup with --user-system-ca. Keep retries isolated per server, preserve quoted options, and monitor the successfully restarted process instead of the exited original.

## 0.22.1

### Patch Changes

- c259e75: Fix image import and resizing in compiled binaries by matching the embedded Photon WASM loader contract. Report decoder failures clearly, and let whiteboard feedback retry a failed image upload without losing the annotation or leaving the queue button disabled.

## 0.22.0

### Minor Changes

- 4bcb811: Move Design mode to SessionV2 with durable review feedback, immutable revisions and approval packages, a shared embedded/browser review surface, isolated React/Solid previews, and design-system evidence.

  Add canonical MCP and plugin image-tool registration, local versioned assets, editable SVG-to-GIF exports, accessibility/scenario checks, and comparison with the approved design. Preserve diagram whiteboards and reconcile the design-owned plan section without overwriting manual work.

  Remove Design from V1 agents, tool registration and HTTP routing. Existing V1 design state is not migrated. New reviews use `/api/session/:sessionID/design/review`; the TUI's `/design` entry guides users to the dedicated `redcode design` terminal.

- 4bcb811: Add `redcode design` for interactive V2 sessions with Design, Plan, and Build modes, durable history and event replay, explicit interruption and resumption, permission and question controls, Goal budgets, and browser review. Existing sessions retain their authoritative mode and do not resume automatically.
- 4bcb811: Add durable SessionV2 goals with explicit mode scope, provider-turn budgets, pause and resume controls, recorded evidence and executed checks. Preserve approved Plan revisions across continuation and compaction, and carry frozen Design audit results into approval and handoff.

  Align Plan permissions and legacy Goal budgets, reject completion without observed evidence, and bound Design browser setup, rendering and cleanup.

### Patch Changes

- 4bcb811: Move reply latency and token throughput from the TUI prompt footer to the Context sidebar.
- 4bcb811: Build native releases with Bun 1.4.1 so Design browser exports can connect to Chromium reliably. Keep bounded browser shutdown and forced process cleanup when rendering is cancelled.
- 4bcb811: Fix React and Solid Design previews in Windows temporary directories and workspaces reached through symlinks or junctions. Use canonical filesystem paths consistently for Vite builds and dependency authorization while continuing to require permission for external imports.
- 4bcb811: Translate the new App Design studio and Goal controls into Brazilian Portuguese. Other locales explicitly fall back to English for these new messages, with source-language plural rules and separately reported translation coverage.

  Refresh Design studio translations when the language changes or finishes loading, while preserving the current form, preview, and ongoing requests.

- 4bcb811: Load Design build and browser tools from a versioned package cache in native binaries, preserving their native dependencies and browser resources. Correct Chromium installation from the compiled CLI, and bound first-use setup and cancellation.
- 4bcb811: Contain Design feedback files and enforce read permissions across prototype imports, stylesheets and assets, including browser-initiated publish and restore. Disable implicit project configuration execution during builds; preprocessors require compiled CSS.

  Encode SVG GIF exports and compare PNGs in a bounded, cancellable worker included in release binaries, keeping raster work off the session server event loop.

  On cancelled or failed commands, terminate remaining process-group descendants even when their parent exited successfully. Preserve successful background launches with explicitly detached output.

- 4bcb811: Restore Design source discovery for root design guidance and nested token, theme, and global-style files. Keep source hashes, excerpts, deterministic limits, and filesystem containment checks while supporting Windows path separators.
- 094df07: Include the internal Design workspace in Changesets version planning and validate the real version command before merging release changes.
- 4bcb811: Provide application services to HTTP requests so embedded SDK and CLI hosts can create and approve Design sessions without requiring callers to supply internal service context.
- 4bcb811: Subscribe to global events before announcing the SSE connection, preventing session updates from falling between recovery snapshots and the live event stream. Release the subscription when the request closes, including abandoned response bodies.
- 4bcb811: Keep sessions usable when a server returns malformed Goal or plan history data by validating responses before updating the composer.
- 4bcb811: Keep permission requests relative to the project when Windows short paths, symlinks, or junctions refer to the same Location. Preserve rejection of relative escapes and links outside the project, and retain separate authorization for external files.
- 4bcb811: Notify language servers when changed file contents have been saved, honoring their save capabilities. This triggers rust-analyzer compiler checks after edits so Rust diagnostics can refresh.
- 4bcb811: Count provider retries against CLI Goal budgets, record terminal execution failures as blocked, and keep exhausted Goals paused until their budget increases. Use available Goal recovery commands and publish the authorized agent and reviewed revision on Plan handoffs.
- 4bcb811: Finalize Goals only after sibling tools and hooks settle, reject completion when new steering is pending, and retain reported provider and reviewer usage even when execution fails or a verdict is stale or interrupted. Apply bounded termination to owned subprocesses so cancel and timeout do not depend on every caller opting into escalation.
- 4bcb811: Release TUI listeners on unmount, bound inactive transcript caches and evict deleted sessions, and recover transcripts and pending interactions only after the event stream connects. Fence delayed navigation and list responses so they cannot overwrite the current workspace or restore deleted sessions. Add `/goal-budget`, accurate resume status, approved Plan-to-Build handoffs, and a discoverable entry for the separate Design workspace.
- 4bcb811: Fix whiteboard startup on Windows by normalizing bundled font paths before mapping browser requests to embedded data URLs. Keep the sandbox's network restrictions intact.

## 0.21.2

### Patch Changes

- 85fead4: Make the prompt's left border follow the selected agent color, including gold for Plan and cyan for Design in the Redcode theme, while preserving the existing fade-in.

## 0.21.1

### Patch Changes

- 3b45192: Self-update on a mise install now lands, instead of reporting success and leaving the old version

  Two things went wrong for an install managed by mise. `mise upgrade` only moves within the version range the config already allows, and red-dev pins an exact version, so mise found the new release, decided it did not match the range, and exited 0 having done nothing. The upgrade now runs `mise upgrade --bump`, which is mise's own idiom for moving the pin as well, and selects the target by name when the bump lands somewhere else, so the version that ends up running is the one the update promised.

  The check afterwards asked whether the target was installed. mise keeps every version it ever fetched and the shim runs the one that is active, so a version could be on disk while the old one kept running: the update reported success and restarting opened the old version again. It now requires the target to be the active one, and when it is installed but not selected it says so and gives the command that fixes it.

- 2fd9cf6: Bound TUI plugin shutdown to two seconds so a stalled disposer cannot indefinitely prevent worker shutdown and return to the parent shell. Preserve normal cleanup and log failures or timeouts.
- 2fd9cf6: Sync upstream provider fixes: GitLab reasoning variants, OpenAI SDK 3.0.88, Azure SDK 3.0.93, and the upstream OpenAI patch preserving explicitly requested service tiers. Check patched dependency versions in both the renamed CLI package and Core.

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
