# V2 Schema Changelog

## 2026-09-16: Requests Sized By The Provider's Own Limit

- Describe `limit.context`, `limit.input` and `limit.output` on a configured model (V2 `providers.<id>.models.<id>.limit` and V1 `provider.<id>.models.<id>.limit`): the context window, the separate input cap and the output cap, and that a limit a provider reports when refusing a request is learned and applied when smaller while setting or changing the configured value clears the lesson. Descriptions only; the fields and their types are unchanged, so existing configurations decode as before.
- Add the state file `model-limits.json` (`{ version: 1, models: { "<provider>/<model>": { input, counted?, estimated?, ratio?, at, message, declared? } } }`) under the state directory, read by both runtimes and by `redcode debug limits`. It is not part of the HTTP API, the durable events or the database.
- Add no route, migration or durable-event version. The `SessionCompaction.compactIfNeeded` preflight of the V2 runner now answers `{ action: "send" | "compacted" | "refuse", reason? }` instead of a boolean; a refusal ends the step with a `session.step.failed` event whose message says the request would exceed the provider's limit.

## 2026-09-15: Design Review Notes Name Their Ancestors

- Add optional `parent` (at most 1200 characters) to each `Design.Feedback.items[]` entry (`POST /api/session/:sessionID/design/:designID/feedback`): the element's parent and grandparent, innermost first, each as its descriptor and absolute XPath, such as `button "Close" (/html/body/div/button) in div[role=dialog] "New conversation" (/html/body/div)`. Raise the `label` limit from 120 to 240 characters. The rendered `<design-review>` message shows `parent` as a `Parent:` line after `XPath:`, and its Next step gains one sentence asking for a `data-design-id` when any note names an element whose target and label carry none. Stored notes without `parent` decode and render as before; a label of at most 120 characters still decodes.
- The in-frame annotation script now sends `label` as a breadcrumb, innermost first: the element (kind, own `data-design-id`, accessible name) followed by `in` and up to three of the named ancestors around it (elements with a `data-design-id`, `id`, `role`, `aria-label` or `aria-labelledby`, and button, a, label, li, nav, header, footer, aside, main, section, article, dialog, form, fieldset, table, details, summary and headings; the two nearest plus the outermost landmark, else the outermost named one), each described by its kind, key and name, with a table cell's row header first; a framework-generated id (React, Radix, Headless UI, MUI, Mantine, Chakra patterns) is left out of the label and kept in `context`. An element outside every named ancestor names its parent, so a label is never a bare tag. A position such as `(2 of 3)` is appended only when other visible elements of the same kind in the same variant root share the whole breadcrumb, counted among at most 50 examined peers (`+` marks a scan that stopped early), and a label cut to 240 characters keeps its position. `context` uses the same ancestors (outermost first, plus a cell's column). No route, migration or durable-event version changes. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`; `packages/sdk/openapi.json` is unchanged because the V1 routes do not carry `Design.Feedback`).

## 2026-09-15: Change The Delivery Of A Waiting Prompt

- Add the durable event `session.next.prompt.delivery` (version 1, aggregate `sessionID`, fields `timestamp`, `sessionID`, `messageID`, `delivery`): the delivery of an admitted prompt changed before its promotion. It is a new type at version 1, so no stored event changes meaning; readers that do not know it ignore it, and a session whose inbox never changed delivery has no such event. Its projector updates the `session_input` row only while `promoted_seq` is null and refuses anything else, and because projection runs inside the append transaction a prompt promoted or removed in the meantime never stores the event.
- Add `POST /session/:sessionID/prompt/:messageID/delivery` (`session.promptDelivery`, payload `{ delivery: "steer" | "queue" }`, 204 on success). It answers `404 NotFoundError` when the prompt is not pending in that session (unknown, already promoted, or removed by a revert). Changing a prompt to `steer` wakes the session the way a prompt sent to an idle session does; a running drain picks it up at its next boundary, since it lists pending steers from the inbox each time. Regenerated the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`), `packages/sdk/openapi.json` (`bun dev generate`) and the V2 client (`bun run generate` in `packages/client`, which gains the new event in its event unions; the V2 surface does not carry the V1 inbox route itself).
- Add no migration: the `session_input` row already stores `delivery`, and nothing about the column changes.

## 2026-09-15: Design Screens

- Add optional `screen` (string, a `data-design-screen` id) to `Design.Scenario`: the audit opens that screen before the scenario's actions. Add optional `screen` to `Design.ParamContext`, carried by `Design.Feedback.params` and each `Design.FeedbackItem.params`: the screen the review page showed when the context was captured. The rendered `<design-review>` message gains a `Screen:` line per note and `screen=` in its preview parameters. Regenerated the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`) and the V2 client (`bun run generate` in `packages/client`).
- Add no route, migration or durable-event version; stored documents and feedback without `screen` decode as before. The review preview and audits inject the in-frame screen runtime (`@reddb-io/redcode-design/screens`), which is not a schema change.

## 2026-09-15: Unambiguous Design Review Note Targets

- Add optional `xpath` (at most 2000 characters: the element's absolute XPath in the revision the note was captured on) and `context` (at most 240 characters: the containers around the element, outermost first, plus the row and column headers of a table cell) to each `Design.Feedback.items[]` entry (`POST /api/session/:sessionID/design/:designID/feedback`). The rendered `<design-review>` message shows them as `Context:` and `XPath:` lines under each note. Stored notes without them decode and render as before.
- The in-frame annotation script now sends a `target` selector verified to resolve to exactly the clicked element within its selected variant root (else the document), and never longer than 1000 characters: a unique `[data-design-id]` (before `#id`, since framework-generated ids change between renders), `#id` or stable attribute, else a path from the nearest unique ancestor, else a copy attribute (`placeholder`, `title`, `alt`, `href`), else the `:nth-of-type` path from `body`. A repeated `data-design-id` keeps its key with its position. An XPath longer than 2000 characters is sent empty rather than cut. A `variant:<id>` target is re-addressed inside that variant root first, then only outside every variant, so earlier targets still resolve and a missing element closes the card instead of matching another variant. `label` names the element by its accessible name (associated label, `aria-label`/`aria-labelledby`, placeholder, text), input type, explicit role and own `data-design-id`, and adds its position among same-tag elements, such as `(2 of 3 <input>)`, when another one has the same label. Values of payment (`autocomplete="cc-*"`), password, hidden and file fields are not sent. Add no route, migration or durable-event version. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`; `packages/sdk/openapi.json` is unchanged because the V1 routes do not carry `Design.Feedback`).

## 2026-09-15: Focus And Loaded Tools On A Compaction

- Add optional `focus` (string) to `SummarizePayload` (`POST /session/{sessionID}/summarize`): instructions for what the summary should focus on, typed as `/compact <focus>` in the TUI. It is stored on the created `CompactionPart` and included in the summary prompt.
- Add optional fields to `CompactionPart`, returned wherever message parts are (the V1 session message routes and `message.part.updated`): `focus` (string, as above); `tools` (`loaded`: tool names loaded through `tool_search`, optional `mcpDeferred` boolean), restored after the compaction so loaded tools stay loaded. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `openapi.json` and `js/src/v2/gen`).
- Add no route, migration or durable-event version; stored parts and requests without these fields decode as before. `--preview` for `/compact` is not implemented.
- Trimming old tool output (`compaction.prune`, now on by default) sets the existing `ToolStateCompleted.time.compacted` mark; the mark is permanent, and the model is pointed at `session_history`, which searches trimmed outputs, instead of re-running the tool.

## 2026-09-15: Provider-Native Tool Search

- Add optional `experimental.tool_search.native` (`"auto"` | `true` | `false`, default `"auto"`) to the configuration schema. Legacy runtime only: `"auto"` uses the provider's tool search for deferred tools on allowlisted models (Anthropic API Claude 4.5 and later via `@ai-sdk/anthropic`; OpenAI GPT-5.4 and later via `@ai-sdk/openai` on the AI SDK runtime), `true` on any model of those packages, `false` never. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`).
- Add optional `deferLoading` to `LLM.ToolDefinition` in `@reddb-io/redcode-llm`, honoured by Anthropic Messages when `providerOptions.anthropic.toolSearch` is `"bm25"` or `"regex"`; the protocol also parses and replays `tool_search_tool_result` blocks.
- No route, migration or durable-event change. A native search persists as a provider-executed tool part named `tool_search_tool_bm25` (Anthropic) or `tool_search` (OpenAI) whose output is the provider result as JSON; a tool it loaded stays deferred when called.

## 2026-09-15: Opt-In Spend Budgets For Goals And Sessions

- Add optional `session` to the current and V1 configuration schemas (`ConfigV2.Session`), carried through the V1 migration unchanged. It holds `budget` (`ConfigV2.SessionBudget`): optional `max_cost_usd` and `max_tokens` (positive finite numbers) and optional `reset_on_message` (boolean, default false). None of these has a default, so nothing is limited unless set. A configured budget binds top-level sessions only, because a subagent's spend already counts toward its parent.
- Add `SpendLimits` (`max_cost_usd?`, `max_tokens?`), `SpendTotals` (`cost`, `tokens`, `unpriced`: tokens spent on models without pricing) and `SessionBudget` (`limits`, `override`, `spent`, `exceeded`, `unknown`, `reason`).
- Add optional `budget` (`SpendLimits`) and `spendStart` (`SpendTotals`) to `SessionGoal`. Add optional `max_cost_usd` and `max_tokens` to `POST /session/:sessionID/goal` (`session.goalSet`). On `POST /session/:sessionID/goal/budget` (`session.goalBudget`), `max_turns` is now optional, and it accepts optional `max_cost_usd` and `max_tokens`: a number sets the limit, null removes it, an absent field keeps it.
- Add `GET /session/:sessionID/budget` (`session.budget`) and `POST /session/:sessionID/budget` (`session.budgetSet`, payload `max_cost_usd?`, `max_tokens?` and `reset_on_message?`, each a value or null). Both return `SessionBudget`, which also carries `reset_on_message` (the session's override, else the configuration). The public OpenAPI document keeps `null` on these payload fields and on the goal budget payload (`httpapi/public.ts` re-adds what its optional-null strip removes), so the generated client can clear a limit. Regenerated the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`). `bun run generate` in `packages/client` and the root `bun dev generate` changed no files.
- `POST /session/:sessionID/goal` now returns `SessionGoalSetResult`: `SessionGoal` plus optional `warnings` (lines that were not understood, such as a spend limit that did not parse, which stay in the objective). A goal text made only of spend lines is refused with `InvalidRequestError` (400, `goal needs an objective`).
- Add optional `unknown` (boolean) to the provider model `cost`. It is set when neither the models catalog nor the configuration gives a price, so a zero-priced model is free and only a model without pricing counts as unknown for cost limits.
- Amounts typed by a person (`/goal` spend lines, `/budget`, `/goal-budget`) are read by one shared parser, `BudgetParse` in core. A dot is a decimal point. A comma followed by exactly three digits, repeated, separates thousands (`1,000`). A single comma with one or two trailing digits is a decimal comma (`2,50`, `1,5m`). Any other use of separators, such as `1.000,50`, is refused with a message.
- Legacy runtime only: running totals are stored in session `metadata.spend` (`cost`, `tokens`, `unpriced`, optional `baseline`, `anchor`, `warned`) and a per-session override in `metadata.budget` (limits and optional `reset_on_message`). Metadata writers now share a per-session lock (`Session.updateMetadata`) and change only their own key. A fork drops `metadata.spend` and the goal's `spendStart` and keeps every limit. A refused step leaves an assistant message with one synthetic, ignored text part (the notice), and ignored assistant text is no longer sent to the model. Session metadata is already a free-form record, so none of this needs a schema change. Add the `budget` guard to the guard log and `BUDGET_PAUSE` (`"budget: "`) to the loop markers. Add no migration or durable-event version. The V2 core runner does not read budgets yet.

## 2026-09-15: Record Context Size Around A Compaction

- Add optional `tokens` (`before`, `after`: estimated tokens of the next request before and after the checkpoint, including system prompt and tool schemas) to `CompactionPart`, returned wherever message parts are (the V1 session message routes and `message.part.updated`). The TUI compaction divider shows it as `Compaction · before → after tokens`. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `openapi.json` and `js/src/v2/gen`).
- Legacy runtime only: the compaction guard state is stored in session `metadata.compaction` (`ineffective`, optional `turn`, optional `paused` `{ after, at }`); session metadata is already a free-form record, so no schema changes. Add no route, migration or durable-event version; stored parts without `tokens` decode as before.

## 2026-09-15: Add Native Monitor Probes, Richer Poll Conditions And Jitter

- Add `Monitor.Probe`, a union on `type`: `Monitor.HttpProbe` (`url`, optional `method` `GET` | `HEAD`, `expect_status` (an integer or a non-empty integer array, default any 2xx), `json_path`, `equals` (string, number or boolean), `contains`, `regex`, `headers` (string record; `{env:NAME}` values resolved per attempt, never rendered)), `Monitor.FileProbe` (`path`, `state` `exists` | `missing` | `changed`, optional `min_size`) and `Monitor.ProcessProbe` (`name` or `pid`, `state` `running` | `exited`). Regular expressions are compiled at decode time and capped at 200 characters; `json_path` accepts dotted keys, bracketed quoted keys and array indexes. Rules spanning fields (an http(s) URL, exactly one of `name`/`pid`, no body matchers on `HEAD`, no `min_size` with `missing`) are enforced by `Monitor.probeProblem` when the tool starts a probe, not by the schema.
- Add optional `success_regex`, `failure_regex`, `until` (`"changed"`) and `jitter` (boolean, default `true`: ±10% of `interval_ms` within 250 ms–30 s, never under 1 s, plus a first-attempt delay within `[0, min(interval_ms, 2 s)]`) to `Monitor.Options`. The legacy `bash` tool refuses `until` and `jitter` with `mode: "once"`. With or without jitter, a wait that would reach `deadline_ms` is shortened so the last attempt starts at least 500 ms before it.
- Add `Monitor.ProbeResult` (`matched`, optional `status`, `value` (JSON text, at most 200 characters), `redirect`, `truncated`, `exists`, `size`, `mtime`, `pids` (at most 10), `error`) and optional `probe` and `matched` (the condition that decided the result) to `Monitor.Evidence`; add optional `probe` to `Monitor.Info`, whose `command` is then a one-line probe label. `GET /experimental/session/:sessionID/monitors` returns them; the rendered `monitor_result` adds `schedule` for polls. Regenerated the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`); the V2 client regenerated unchanged.
- Add `probe` to the `monitor` tool actions (`Monitor.Control` gains `probe`, `interval_ms` and `deadline_ms`). Legacy runtime only: the V2 core runner has no monitors, so neither probes nor the new conditions apply there. Add no route, migration or durable-event version; stored monitors without the new fields decode as before.
- Add optional `match` (`name` | `cmdline`, default `name`: the executable name exactly) to `Monitor.ProcessProbe`, and optional `error` (a condition that could not be evaluated on an attempt, such as a regular expression that timed out) to `Monitor.Evidence`. An http probe's `{env:NAME}` header values ask the `env` permission with the pattern `NAME@host` before the monitor starts. Regenerating the legacy SDK also adds `paraphrase?: string` to the todo types from the earlier todowrite change, which main's generated SDK was missing.

## 2026-09-15: Configure Code Mode

- Add optional `experimental.mcp_validation` (`"strict"` | `"warn"` | `"off"`): whether MCP tool arguments are checked against the server's input schema. Unset, direct calls log a mismatch and call the tool anyway, and code mode scripts refuse it; set, both follow it. Server `pattern`/`patternProperties` are not enforced, and schemas above 256 KB are not validated. It lives under `experimental` because top-level `mcp` is the record of server configurations.
- Add optional `experimental.code_mode` to the V1 configuration schema: `enabled` (`"off"` | `"auto"` | `"on"`, default `"off"`), `models` (wildcard patterns matched against `<provider>/<model.api.id>` and the bare `model.api.id`, so `anthropic/*` also matches OpenRouter's `anthropic/...` IDs; `"auto"` enables nothing without it), `threshold` (positive integer, estimated tokens of MCP tool schemas above which `"auto"` turns code mode on, default 6000), `max_tool_calls` (default 50), `timeout_ms` (default 120000; permission prompt time is not counted) and `max_output_bytes` (default 1000000). `REDCODE_EXPERIMENTAL_CODE_MODE=true` still forces code mode on. Legacy runtime only: the V2 core runner has no code mode. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`).
- Add no route, migration or durable-event version. The `execute` tool part metadata gains optional `rejected`, `truncated` and `outputPath`, and each `toolCalls` entry gains an optional `title`. A permission request raised from a script carries `metadata.script` (`tool`: script path, `args`: an args preview of at most 300 characters).

## 2026-09-15: Configure Models Catalog Sources

- Add optional `models.sources` (array of URL strings) to the current and V1 configuration schemas; the V1 migration carries it through unchanged. The models catalog tries `REDCODE_MODELS_URL`, then `models.sources`, then `https://models.opencode.ai/api.json` and `https://models.dev/api.json`. A URL without a `.json` path gets `/api.json` appended. Only the global configuration (the user config directory, `REDCODE_CONFIG_DIR`, `REDCODE_CONFIG`, `REDCODE_CONFIG_CONTENT`) is read, because the catalog cache is shared by every project. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`).
- Add no route, migration or durable-event version. `models-dev.refreshed` is now published only when the fetched catalog differs from the cache. The catalog cache is one `models.json` file with a `models-state.json` sidecar (last source, fetch time, per-source backoff), replacing the per-URL `models-<hash>.json` files.

## 2026-09-15: Configure Tool Search

- Add optional `experimental.tool_search` to the configuration schema: `enabled` (`"auto"` | `true` | `false`, default `"auto"`) and `threshold` (positive integer, estimated tokens of MCP tool schemas, default 3000). Legacy runtime only: with `"auto"` the legacy loop defers MCP tools above the threshold (never in code mode) and `design_*` tools outside a Design context behind the `tool_search` tool (`query`, `select`, `limit`); `true` always defers MCP tools. The V2 core runner does not read it yet. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`).
- Add no route, migration or durable-event version; `tool_search` records what it loaded in its tool part metadata (`loaded`, `notFound`), which the loop reads back from history.

## 2026-09-14: Track Session Monitors

- Add the `session_monitor` table (migration `20260915002032_session_monitors`): `id`, `session_id` (deleted with its session), `owner` (the runtime running the monitor, `pid:process-start-time:uuid`, so another live runtime on the same database is never mistaken for a crashed one) and `data` (`Monitor.Info` as JSON), indexed by session.
- Add `Monitor.Options` (`mode` `once` | `poll`, optional `wait_ms`, `deadline_ms`, `interval_ms`, `success_contains`, `failure_contains`), `Monitor.Evidence`, `Monitor.Process` (`pid`, `started`: the detached process group last spawned, identified by its start time) and `Monitor.Info` (`status` `running` | `succeeded` | `failed` | `timed_out` | `cancelled` | `interrupted`, `delivery` `pending` | `observed` | `delivered` | `failed` | `suppressed`, optional `process` and `interruptedBy`).
- Add `GET /experimental/session/:sessionID/monitors` (`experimental.monitors.list`) and `POST /experimental/session/:sessionID/monitors/:monitorID/cancel` (`experimental.monitors.cancel`, `null` when the monitor is not in that session). Add optional `monitor` (`Monitor.Options`) to the legacy `bash` tool input and the `monitor` tool (`Monitor.Control`: `list` | `get` | `wait` | `cancel`). Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`).
- A monitor's completion is admitted to the `session_input` inbox with `delivery: "queue"`. Legacy runtime only: the V2 core `bash` tool has neither `monitor` nor the sleep-polling guard yet.

## 2026-09-14: Request Variant Operations Through Design Feedback

- Add optional `pending` to the `user` entry of `Design.FeedEvent` (`GET /api/session/:sessionID/design/feed`): `true` when the entry comes from `session.next.prompt.admitted` (admitted, not yet delivered into a turn), absent when it comes from `session.next.prompted`. The review page counts a variant operation as taken up by the agent only once its entry arrives without `pending`. The legacy host (`GET /design/session/:sessionID/feed`) writes the user message at admission, so it marks the entry `pending` until `message.promoted` (Prompt Promotion) arrives and then repeats it without the flag; its whole-transcript replay reads the pending rows of the `session_input` inbox.
- Add `Design.VariantOperation` (`kind`: `delete` | `rename` | `reorder` | `merge` | `split`; `variants`: 1–20 variant ids; optional `labels`, `name` (rename), `order` (reorder, the full id list) and `text` (merge or split guidance, at most 2 000 characters)) and optional `action` on `Design.Feedback` (`POST /api/session/:sessionID/design/:designID/feedback`). The per-kind rules (one variant for delete, rename and split; two or more for merge; `order` a permutation of `variants` for reorder; `name` only on rename, `text` only on merge and split) span several fields, which the generated clients cannot express, so `Design.variantOperationProblem` enforces them on admission (rejected with the `invalid` design error, which the design routes answer with 409 like other refused feedback) instead of the schema. A review carrying an operation needs no text or notes.
- Add optional `operation` (one line such as `delete Compact`) to `Design.FeedbackNotice`; the rendered review gains a `## Variant operation` section with the rules the agent follows, and the conversation feed shows `Variant operation: …` for a review without a message.
- Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`; `packages/sdk/openapi.json` is unchanged because the V1 routes do not carry `Design.Feedback`).
- Add no migration or durable-event version; frozen feedback rows without `action` render as before.

## 2026-09-14: Relax The Todo Input Contract For Updates

- `Todo.Input` (the `todowrite` tool input in both runtimes, not carried by any HTTP route) now makes `content` and `priority` optional: they are required to create a task and default to the stored values when `id` and `revision` address an existing one. `evidence` documents that an omitted value on completion selects the newest successful result after the request. Add `Todo.ModelInput`, the decoder the tools use at the model boundary, which folds `text`, `title` and `task` into `content`; the advertised JSON schema stays `Todo.Input`. `Todo.Info`, `Todo.Evidence` and `todo.updated` are unchanged. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`); neither changed because `Todo.Input` is not part of the public HTTP surface.
- Add no migration or durable-event version; stored tasks decode as before.

## 2026-09-14: Record The Project's Design System On Design Documents

- Add `Design.Component` (`root`, `file`, `name`, optional `props`) and optional `inventory` (bounded static scan of exported components per component root) and `manifest` (a one-line status of the generated `.red/DESIGN.md`: generated, refreshed, kept and why, or empty) to `Design.Info`, returned by every design document route (`GET/POST/PATCH /api/session/:sessionID/design...`). Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `js/src/v2/gen`; `packages/sdk/openapi.json` is unchanged because the V1 routes do not carry `Design.Info`).
- Design source discovery also records component barrels, Storybook and PostCSS configuration, a dependency-only slice of `package.json` and story files as names-only entries, ordered configuration, docs, tokens, barrels, stories with a 60-entry cap and excerpts for the first twenty; a generated `.red/DESIGN.md` is discovered but not `authoritative`.
- Add no migration or durable-event version; stored documents without the new fields decode as before.

## 2026-09-14: Record The Configured Design System On Design Documents

- Add the optional `Design.Info.system` (`Design.System`: `paths`, `css`, `tailwind`, `framework?`, `aliases?`), the effective design system resolved at design creation and refresh from the `design.system` configuration section completed with package.json and `tailwind.config.*` defaults. Paths are project-relative. Preview builds read it to pre-authorize the declared roots, run the project's PostCSS pipeline and include the declared stylesheets; `design_preview` asks one standing `read` (and, for a linked worktree, `external_directory`) permission for the declared set instead of a prompt per imported file. No route changes. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`packages/sdk/openapi.json`, `js/src/v2/gen`).
- Add the `design` configuration section (`design.system.paths`, `css`, `tailwind`, `framework`, `aliases`) to the current and V1 configuration schemas; the V1 migration carries it through unchanged.

## 2026-09-12: Add The Design Conversation Feed

- Add `GET /api/session/:sessionID/design/feed?after=` (`design.feed`), a Server-Sent Events stream of `Design.FeedEvent` entries reduced on the server from the session's durable events: `user` (`text` plus a `notes` count; a browser review collapses to its message and the number of notes), `reply` (finished assistant text), `tool` (running, done or failed, with a one-line summary), `published` (a `design_preview` success naming the design, revision and name), `agent` and `state` (`working` | `idle`, sampled from the process-local execution set). `seq` is the durable aggregate sequence to resume from (0 for live-only entries); `id` lets a client merge repeats. Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`packages/sdk/openapi.json`, `js/src/v2/gen`).
- The legacy TUI host serves the same shape at `GET /design/session/:sessionID/feed?after=` (GET only, same-host rule) from the V1 transcript and bus. `after` is validated but not applied: the V1 bus has no durable sequence, so every entry carries `seq: 0`, every connection replays the whole transcript and the client merges repeats by `id`.
- Add optional `revision` to `Design.FeedbackItem` so a note drafted before a live reload records the revision it was captured on; the rendered review prints `Revision:` for notes whose revision differs from the message's.
- Add no migration or durable-event version; the feed is a read projection over existing events.

## 2026-09-12: Label Design Review Notes

- Add optional `tag`, `elementText` (at most 240 characters), `selectedText` (at most 12 000 characters; a clicked diagram's source is sent here) and `label` to each `Design.Feedback.items[]` entry (`POST /api/session/:sessionID/design/:designID/feedback`) so the browser sends the user's note separately from the clicked element's context; the top-level `text` may now be empty when every note lives in `items`. Admission rejects a review with no text, notes, whiteboards or assets, and a page snapshot above 30 000 characters (enforced on admission so frozen rows and approval packages stay readable). Regenerated the V2 client (`bun run generate` in `packages/client`) and the legacy JavaScript SDK (`packages/sdk/openapi.json`, `js/src/v2/gen`).
- Add `Design.FeedbackNotice`, the compact summary the legacy bridge stores as `metadata.designFeedback` on the review's text part for transcript rendering.
- Extend the `design_read` tool input with section `snapshot` and an optional `feedback` id; it reads the page text captured with a browser review note and needs no approval record. The review message itself no longer embeds the snapshot.
- Add no migration or durable-event version; frozen feedback rows without the new fields render as before.

## 2026-09-11: Add Delivery To Legacy Prompt Payloads

- Add optional `delivery` (`steer` | `queue`) to the V1 `POST /session/:sessionID/message` and `POST /session/:sessionID/prompt_async` payloads; omitted means `steer`. The V2 client (`bun run generate` in `packages/client`) does not cover these V1 routes and is unchanged; the legacy JavaScript SDK (`./packages/sdk/js/script/build.ts`: `packages/sdk/openapi.json`, `js/src/gen`, `js/src/v2/gen`) is regenerated for the payload and for `EventMessagePromoted` / `SyncEventMessagePromoted`.
- Legacy prompts now publish `session.next.prompt.admitted.1` for a sidecar `session_input` row next to the canonical V1 `message` rows. No `session.next.prompted.1` event and no V2 user row are produced for legacy sessions.
- Add the durable V1 session-aggregate event `message.promoted.1` (`{ sessionID, messageID }`): the loop publishes it after re-publishing the promoted user message, and the projector stamps `promoted_seq` on the inbox row from its sequence, so sync/steal replay rebuilds promotion. A re-published `message.updated` only moves `time_created` forward.
- Add no migration or durable-event version.

## 2026-06-26: Add Finite Session History

- Add `GET /api/session/:sessionID/history` and generated Promise, Effect, and legacy JavaScript client methods.
- Page public durable Session events after an optional exclusive aggregate sequence, with an explicit `hasMore` exhaustion signal.
- Keep aggregate gaps legal, cap pages at 100 events, and preserve the existing durable replay-and-tail `sessions.events()` stream unchanged.
- Add no migration or durable-event version; this is a finite read API over the existing event manifest.

## 2026-06-22: Simplify Session Input Promotion

- Keep `session.next.prompt.admitted.1` as the durable, client-visible record of pending Session input.
- Replace `session.next.prompt.promoted.1` with the existing `session.next.prompted.1` event when input becomes model-visible.
- Preserve the prompt endpoint, admission receipt, idempotency, steer/queue ordering, and atomic user-message projection.
- Reset experimental V2 events, projections, inputs, Context Epochs, and synchronized workspace state while preserving canonical V1 `session`, `message`, and `part` rows.

## 2026-06-22: Reset Unpublished Compaction Event

- Replace the unpublished `session.next.compaction.ended.1` payload with the current checkpoint payload and remove its legacy decoder.
- Reset experimental events, sequences, Session inputs, projected Session messages, Context Epochs, synchronized workspace rows, and Session workspace links.
- Preserve canonical V1 `session`, `message`, and `part` rows.

## 2026-06-22: Make Session Interruption Process-Local

- Remove the unprojected `session.next.interrupt.requested.1` event from the experimental durable Session event union and generated SDK.
- No canonical V1 data requires migration; experimental V2 event history containing the retired event is disposable.

## 2026-06-05: Execute Automatic Session Compaction

- Trigger automatic compaction before provider turns using the complete estimated request and absolute model-aware headroom.
- Preserve the existing structured summary contract and update prior summaries with newly compacted history.
- Store token-bounded recent history as plain serialized text inside the checkpoint instead of replaying provider-native messages.
- Keep compaction starts durable and progress deltas live-only; activate history cutover only from a durable completed summary.
- Store the completed event with the current checkpoint payload containing stable message identity, reason, summary, and recent context.
- Reload the replacement Context Epoch and continue the original pending turn after compaction.
- Preserve full durable history; compaction changes only the active model representation.
- Defer provider-overflow recovery, explicit manual compaction, and deterministic old tool-result pruning.

Record V2 database, durable-event, projected-message, HTTP, and generated SDK schema changes here. Each entry states why the contract changed and whether consumers or stored data need compatibility handling. Commit messages for schema-affecting changes should include the same summary.

This document covers meaningful contract changes introduced on the `feat/opencode-embedded-api` branch since its divergence from `origin/dev`. Mechanical file moves and internal refactors are omitted unless they changed stored data, replay behavior, public HTTP or SDK shapes, or model-facing tool contracts.

## 2026-06-04 Event-Sourced Session Input Cutover

Affected schema:

- `session_input`, `session_message`, `event`, `event_sequence`, and disposable workspace beta storage.
- New synchronized `session.next.prompt.admitted.1` and `session.next.prompt.promoted.1` events.
- Experimental `SessionV2.prompt(...)`, HTTP, and generated SDK admission receipt.

Change:

- Replace inbox-local admission sequence with event-sourced prompt admission and promotion sequences.
- Give projected Session messages stable `msg_*` resource IDs distinct from `evt_*` creator event IDs.
- Give every event that creates a projected transcript resource an explicit `msg_*` resource ID. Assistant steps propagate one `assistantMessageID` through assistant-owned events.
- Reset incompatible unreleased beta event history, derived Session projections, workspace rows, and Session workspace links.

Compatibility:

- The reset preserves canonical V1 `session`, `message`, and `part` rows.
- Existing synchronized workspaces are disposable beta state and are removed by the reset.
- Before starting the new build, discard adapter-managed external workspace resources created by unreleased builds. The SQL migration cannot remove external resources through runtime adapters, and rediscovering retained resources after startup can replay incompatible beta history.
- Exact prompt retries reconcile one stable `msg_*` identity when Session, prompt, and delivery mode match.

## Earlier Branch History

### Replayable Session Event Refinement And Cursor Stream

Affected schema:

- Existing synchronized `session.next.*` event family in `packages/core/src/session/event.ts`.
- Existing projected V2 Session-message union in `packages/core/src/session/message.ts`.
- New explicit durable-event union and internal replay cursor returned by `sessions.events({ sessionID, after? })`.

Change:

- Keep the existing Session lifecycle event family and projected-message union rather than introducing them in this branch.
- Stop synchronizing text deltas, reasoning deltas, and tool-input deltas; keep them explicitly ephemeral.
- Add an explicit durable-event union for replay-safe consumers.
- Add replay-and-tail aggregate cursors backed by durable Session-event sequence.
- Encode synchronized event payloads before writing JSON storage and decode them while replaying so schema transforms remain explicit at the durable boundary.

Reason:

- Embedded Session execution needs a reconnect-safe replay stream over the existing durable log and derived chronological read model.
- Fragment streams are useful to connected renderers but must not advance durable cursors or inflate synchronized storage.

Compatibility:

- The `session.next.*` lifecycle event family predates this branch; this branch refines its experimental V2 durability and replay contracts.
- Durable replay cursors are per-aggregate event sequences; ephemeral deltas are intentionally absent after reconnect.

### Durable Step Settlement Ownership

Affected schema:

- `session.next.step.ended` and `session.next.step.failed` synchronized event version `2`.

Change:

- Bind step settlement to an explicit assistant message ID.

Reason:

- Provider-local call identifiers can repeat across turns.

Compatibility:

- Step settlement uses synchronized event version `2` because the durable payload changed.

### Durable Session Input Inbox

Affected schema:

- New `session_input` table from `20260603141458_session_input_inbox.ts`.
- Updated pending-input index from `20260603160727_jittery_ezekiel_stane.ts`.
- New `SessionInput.Admitted` schema and `Prompted.delivery` field.
- Prompt-admission conflict behavior in `SessionV2.prompt(...)`.

Change:

- Persist admitted prompts before projection with an autoincrement inbox sequence, unique message ID, Session ID, encoded prompt, `steer` or `queue` delivery mode, optional promoted event sequence, and creation time.
- Index pending inputs by Session, promotion state, delivery mode, and admission sequence.

Reason:

- Prompt admission and model-visible promotion must be separate durable operations.
- Steering must promote at safe provider-turn boundaries while queued prompts remain pending in FIFO order until continuation would otherwise end.

Compatibility:

- Database migration creates the inbox table and replaces its first pending index with a delivery-aware index.
- Exact prompt retries are idempotent; reusing a message ID for different input fails.

### Durable Session Projection Order

Affected schema:

- `session_message.seq` from `20260603040000_session_message_projection_order.ts`.
- Session-message and event indexes from `20260603001617_session_message_projection_indexes.ts`, `20260603040000_session_message_projection_order.ts`, and `20260603160727_jittery_ezekiel_stane.ts`.

Change:

- Reset pre-launch Session-message projections and add `session_message.seq` for newly projected synchronized events.
- Add event aggregate-sequence and aggregate-type-sequence indexes.
- Add Session-message sequence, type-sequence, and compatibility timestamp indexes.

Reason:

- Projected history, replay, compaction lookup, and pagination must follow durable aggregate order rather than timestamps or caller-generated IDs.
- Runner and HTTP read paths need covering indexes for their concrete lookup shapes.

Compatibility:

- Pre-launch Session-message projections are disposable because historical versions could write them without durable creator events.
- The migration resets those projections rather than inventing chronology or blocking startup.
- The timestamp compatibility index remains for legacy or transitional query shapes.

### Structured Tool Registry And Canonical Output

Affected schema:

- Core-owned typed tool registry contract.
- Canonical tool output content and structured settlement schemas.
- Canonical tagged tool file sources in `@reddb-io/redcode-llm`.
- Durable tool called, progress, success, and failure events and projected assistant-tool states.

Change:

- Validate model input against each registered tool's parameter schema.
- Validate handler success against each tool's success schema before optional pure model-output lowering.
- Generate optional tool-definition output JSON Schema from typed success schemas.
- Persist canonical structured output and content for running, completed, and failed tools.
- Represent tool files explicitly as inline data, remote URL, or managed file URI sources rather than one ambiguous URI string.

Reason:

- Embedded tool execution needs one typed boundary between provider calls, local side effects, durable settlement, and replay.

Compatibility:

- These are additive experimental V2 runtime contracts.
- Tool results are durably settled before provider continuation.
- Legacy text, JSON, and inline-media results remain convertible; unresolved URL and file sources must be materialized or explicitly rejected before provider lowering.

### Managed Tool-Output Files

Affected schema:

- New optional managed `outputPath` and `outputPaths` fields on tool results and completed Session tool state.
- Absolute managed output paths accepted by ordinary `read` and `grep` inputs.

Change:

- Spill oversized model-facing tool text into globally unique files under OpenCode's shared tool-output directory.
- Include the absolute file path in the bounded preview so ordinary `read`, `grep`, and `bash` operations can inspect it.

Reason:

- Tool results need bounded model context without discarding the full output.
- Filesystem resolution admits only direct generated `tool_*` files from the managed directory, while existing permissions whitelist that directory.

Compatibility:

- Managed output is retained for a bounded period and exposed as a normal host filesystem path.

### Location-Scoped Filesystem Read And Search Contracts

Affected schema:

- Core filesystem read, directory-list, root-resolution, and named-reference inputs.
- `LocationSearch.FilesInput`, `LocationSearch.GrepInput`, and bounded result schemas.
- `read`, `glob`, and `grep` tool parameters and success payloads.

Change:

- Add bounded file reads, paged directory listings, bounded glob results, and bounded grep matches with line previews.
- Allow named project references for read-oriented operations.
- Resolve and pin canonical approved search roots before traversal.
- Exclude hidden path segments from broad V2 glob and grep discovery.

Reason:

- Embedded tools need deterministic bounds and a shared path-containment authority.
- Broad search should not disclose hidden files implicitly.

Compatibility:

- These are additive V2 tool contracts.
- Hidden-file discovery is intentionally narrower than an unconditional ripgrep `--hidden` traversal.

### Location Workspace Identity

Affected schema:

- `Location.Ref.workspaceID`.
- V2 Location HTTP middleware routing.

Change:

- Brand optional Location workspace identity as `WorkspaceV2.ID` instead of an untyped string.
- Preserve nested `location[workspace]` and workspace-header routing inputs while decoding them into the branded identity.

Reason:

- Location-scoped services and embedded routing need one typed workspace identity boundary.

Compatibility:

- Existing workspace strings remain accepted when they satisfy the workspace ID schema.
- Generated OpenAPI reflects the workspace prefix constraint.

### Structured Mutation Authority And File Leaves

Affected schema:

- New `LocationMutation.ResolveInput`, planned target, external-directory authorization, and typed path errors.
- New `write` and exact `edit` tool schemas.
- New internal file-mutation commit service.

Change:

- Resolve relative mutation paths within the active Location.
- Accept absolute internal paths and require explicit `external_directory` approval before leaf approval for external absolute paths.
- Keep named references read-oriented and reject them for mutation.
- Revalidate path authority immediately before write mechanics.

Reason:

- Mutation tools need explicit capability escalation and symlink/path-swap checks without pretending path APIs provide a syscall-level sandbox.

Compatibility:

- These are additive V2 mutation contracts.
- Richer V1 fuzzy edit behavior remains intentionally deferred.

### V2 Permission Requests And Saved Rules

Affected schema:

- `PermissionV2.Request`, `AssertInput`, `ReplyInput`, source metadata, tagged errors, and lifecycle events.
- V2 permission list, reply, and saved-rule HTTP routes and generated SDK schemas.

Change:

- Add Location-scoped pending permission requests with `once`, `always`, and `reject` replies.
- Attach optional originating tool message and call IDs.
- Preserve authored ordered rules and saved approvals as separate inputs to evaluation.
- Establish action and resource conventions for `read`, `glob`, `grep`, `edit`, `external_directory`, `bash`, `todowrite`, and `webfetch` approvals.

Reason:

- Embedded tool calls need a Core-owned authorization boundary that can suspend and resume through HTTP.

Compatibility:

- These are additive experimental V2 contracts.
- Policy authors should account for canonical resource forms; originating tool source metadata remains optional until every registry call carries its durable assistant owner.

### Initial Core V2 Built-In Tool Schemas

Affected schema:

- `read`, `glob`, `grep`, `write`, exact `edit`, `bash`, and `websearch` model-facing tool contracts.

Change:

- Add Core-owned Location-scoped built-ins with explicit parameter and success schemas.
- Bound bash output and timeout input, search result counts and previews, read sizes, directory pages, and websearch result/context controls.

Reason:

- Embedded runner launch requires a minimal typed tool set without importing legacy application orchestration.

Compatibility:

- These are additive V2 built-ins.
- Richer launch-follow-up leaves such as `apply_patch`, skill loading, task dispatch, and LSP remain separate slices.

### Bash Advisory Warnings

Affected schema:

- Optional `warnings` in the `bash` tool success payload.

Change:

- Return advisory warning strings when best-effort command-argument scanning detects external absolute paths; keep structured external `workdir` approval enforced.

Reason:

- A shell subprocess has host-user filesystem, process, and network authority. Token scanning cannot honestly provide containment.

Compatibility:

- Consumers rendering bash success should tolerate optional warning strings.

### V2 Session HTTP And Generated SDK Contracts

Affected schema:

- V2 Session list, prompt, context, message-list, compact, and wait HTTP routes.
- V2 Location query routing fields.
- Generated OpenAPI and JavaScript SDK schemas.

Change:

- Expose embedded Session creation and read-side behavior over the experimental HTTP API.
- Accept optional prompt admission `id`, `delivery`, and `resume` fields so callers can request idempotency, steering or queue semantics, and durable admission without immediate execution.
- Keep message cursors opaque and preserve configured Location routing through both legacy flat and nested `location[...]` query parameters in the V2 SDK client.

Reason:

- Remote and embedded consumers need one generated contract while Location middleware remains compatible with current server routing.

Compatibility:

- These are experimental V2 routes.
- Prompt admission now returns the admitted user-shaped message and may return a conflict error when one message ID is reused for different input.
- SDK Location GET rewriting preserves existing flat query behavior and adds nested compatibility parameters.

## 2026-06-03: Durable Session Message Pagination

Affected schema:

- Internal `SessionV2.messages()` cursor input.
- Opaque cursor payload returned by `GET /api/session/:sessionID/message`.

Change:

- Remove wall-clock `time` from the message cursor payload.
- Resolve the opaque cursor's projected message `id` to its stored `session_message.seq`.
- Apply page boundaries and ordering with durable per-session `seq` rather than `time_created` plus `id`.

Reason:

- Projected V2 message chronology is defined by synchronized Session-event order.
- Wall-clock timestamps may collide or move backwards, so they are not safe pagination boundaries.
- The list endpoint must agree with replay and context loading, which already order by durable sequence.

Compatibility:

- No database migration is required. `session_message.seq` and its session-scoped index already exist.
- The HTTP cursor remains opaque and existing cursors remain usable because they already carry the projected message `id`; older extra `time` data is ignored while decoding.
- No OpenAPI or generated SDK schema changes are required for this pagination correction.

## 2026-06-03: Public Provider And Model Catalog DTOs

Affected schema:

- Responses from `GET /api/provider`, `GET /api/provider/:providerID`, and `GET /api/model`.
- Generated `ProviderV2PublicInfo` and `ModelV2PublicInfo` SDK schemas.

Change:

- Replace internal catalog response schemas with explicit public DTOs.
- Remove provider request headers and bodies, API settings, custom enablement data, model request overrides, and variant request overrides from public responses.

Reason:

- Internal catalog records may contain credentials or provider-specific request material and must not cross the public HTTP serialization boundary.

Compatibility:

- Public V2 catalog responses intentionally expose fewer fields.
- Internal provider and model schemas remain available to the runtime.

## 2026-06-03: Durable Reasoning And Hosted Tool Replay Metadata

Affected schema:

- Durable `session.next.reasoning.started` and `session.next.reasoning.ended` events.
- Durable `session.next.tool.success` and `session.next.tool.failed` events.
- Projected assistant reasoning and settled tool message state.

Change:

- Add optional reasoning `providerMetadata`.
- Add optional durable tool `result` and project it into settled tool message state.
- Preserve projected tool-call metadata separately from optional settlement-result metadata.
- Replay provider-native reasoning and tool metadata only when the historical assistant model matches the selected continuation model.

Reason:

- Provider continuation requires signed or encrypted reasoning metadata on later turns.
- Provider-executed hosted tool results must survive projection so replay can keep hosted calls and results inline in assistant content.
- Recovery settlement must not erase provider-native call metadata needed to reconstruct a valid continuation request.

Compatibility:

- Added durable-event fields are optional so previously recorded experimental events remain decodable.
- Projected settled tool state gains model-facing result data when available.
- Projected assistant tools gain optional result-side provider metadata; the existing metadata slot remains the backward-compatible call-side slot.
- OpenAI Responses lowers reconstructed provider-executed hosted results to stored item references instead of rejecting assistant history.
- Bedrock Converse signatures, Gemini `thoughtSignature`, and OpenAI-compatible Chat `reasoning_content` now round-trip through canonical continuation parts.

## 2026-06-03: Projected Assistant Ownership And Full-Value Parts

Affected schema:

- Projected assistant text parts.
- Durable text and tool lifecycle boundaries.
- Projected assistant tool ownership.

Change:

- Preserve stable IDs on projected assistant text parts.
- Route durable tool projection updates through explicit owning assistant message IDs rather than provider-local call IDs alone.
- Replay full-value text and tool-input end checkpoints while keeping fragment deltas ephemeral.

Reason:

- Provider-local tool call IDs may repeat across turns.
- Durable projection reconstruction must not depend on ephemeral fragments that disappear after reconnect.

Compatibility:

- Earlier experimental projected assistant rows without stable text IDs are not assumed replay-compatible.
- Current V2 histories reconstruct from durable full-value checkpoints.

## 2026-06-03: Location-Scoped V2 Questions

Affected schema:

- New `QuestionV2.*` domain schemas.
- New `question.v2.asked`, `question.v2.replied`, and `question.v2.rejected` events.
- New question list, reply, and reject HTTP routes and generated SDK schemas.

Change:

- Add schemas for pending requests, question options, ordered answers, and tool ownership metadata.
- Add `GET /api/question/request`.
- Add `POST /api/session/:sessionID/question/request/:requestID/reply`.
- Add `POST /api/session/:sessionID/question/request/:requestID/reject`.

Reason:

- Embedded V2 tool execution needs a Location-owned pending-question service whose suspended replies can be settled through HTTP.

Compatibility:

- These are additive experimental V2 contracts.
- No database migration is required because pending questions are intentionally in-memory Location state.

## 2026-06-03: Core-Owned Todo Update Event

Affected schema:

- Core-owned `SessionTodo.Info`.
- Global `todo.updated` event registration.

Change:

- Register the todo update event from Core session-todo ownership and expose the existing todo item shape to the Core V2 tool.

Reason:

- Embedded V2 `todowrite` execution needs Core-owned persistence and update publication without importing legacy application orchestration.

Compatibility:

- The todo table and public todo update event shape are preserved.
- No database migration is required.

## 2026-06-03: Added Core V2 Tool Schemas

Affected schema:

- New `todowrite` tool parameters and success payload.
- New `question` tool parameters and success payload.
- New `webfetch` tool parameters and success payload.

Change:

- Add a todo replacement-list tool using `SessionTodo.Info` items.
- Add a question tool using ordered `QuestionV2.Prompt` values and ordered answer arrays.
- Add an HTTP(S) fetch tool with explicit `text`, `markdown`, and `html` formats, bounded timeout input, and optional managed output resource metadata.

Reason:

- Embedded V2 execution needs Core-owned built-ins rather than imports from legacy application orchestration.
- Explicit schemas keep model-facing definitions, runtime validation, and durable tool settlement aligned.

Compatibility:

- These are additive Location-scoped V2 built-ins.
- No database migration or public HTTP API migration is required.

## 2026-06-03: Conditional File-Mutation Stale Error

Affected schema:

- New internal `FileMutation.StaleContentError` tagged error.

Change:

- Add a typed error carrying the mutation target path when an approved exact edit no longer matches the bytes at commit time.

Reason:

- V2 exact edits must fail rather than stale-clobber a concurrent cooperating write after permission approval.

Compatibility:

- This is an additive internal error contract.
- No database, HTTP, or generated SDK schema changes are required.

## 2026-06-03: Provider Stream Watchdog Policy Deferred

Affected schema:

- No database, durable-event, HTTP, or generated SDK schema changes.
- Internal Session-runner provider-stream policy.

Change:

- Do not impose a universal provider-stream inactivity or absolute timeout.
- Remove the internal timeout error and hardcoded watchdog service.
- Defer provider timeout, retry, watchdog, durable failure-reporting, and drain-chain-release policy to a configurable design slice.

Reason:

- V1 had no universal processor inactivity watchdog.
- Providers and autonomous workloads have different runtime characteristics, so one hardcoded default is premature.

Compatibility:

- No migration or generated artifact regeneration is required.
- Embedded runner callers do not receive a runner-defined provider-stream timeout error.

## 2026-06-03: Keyed Coalescing Durable Tail Signals

Affected schema:

- No database, durable-event, HTTP, or generated SDK schema changes.
- Internal durable aggregate-tail wake delivery only.

Change:

- Replace the process-global unbounded aggregate-ID PubSub with one sliding-capacity-1 dirty signal per active tail and aggregate.
- Subscribe and register the signal before historical SQLite replay, then remove it when the tail closes.
- Re-query durable rows after each dirty edge and advance only by persisted aggregate sequence.

Reason:

- Wake notifications are advisory edges, not durable event payloads.
- Slow consumers should not retain an unbounded number of redundant wake IDs when one SQLite query can recover every committed row after their cursor.
- Per-tail signaling preserves independent cursors for multiple consumers of the same aggregate.

Compatibility:

- No migration, synchronized event version, OpenAPI, or SDK regeneration is required.
- `sessions.events({ sessionID, after? })` remains a replay-and-tail stream of every durable event in aggregate sequence order.

## 2026-06-03: Sequential V2 Apply Patch Tool

Affected schema:

- New Core-owned `apply_patch` model-facing tool parameters and success payload.
- New Core-owned pure patch hunk representation for add, update, and delete operations.

Change:

- Accept `{ patchText: string }` using the `*** Begin Patch` envelope.
- Return ordered applied-operation records carrying `type`, canonical `target`, and permission-facing `resource`.
- Resolve and approve every target before reading approved update/delete contents.
- Preflight update/delete correctness before committing operations sequentially.
- Report already-applied resources explicitly when a later commit fails.

Reason:

- Embedded V2 agents need reviewable multi-file edits without importing legacy application orchestration into Core.
- Sequential semantics are small and honest: they avoid claiming rollback or transactionality that path-based filesystem commits do not provide.

Compatibility:

- This is an additive model-facing V2 tool contract.
- Moves and atomic rollback are deliberately unsupported in the first slice and remain visible follow-ups.
- No database migration, durable-event version, public HTTP, OpenAPI, or generated SDK change is required.

## 2026-06-03: Embedded Local-Tool Recovery Alignment

Affected schema:

- No database, durable-event, HTTP, or generated SDK schema changes.
- Internal runner recovery and permission evaluation behavior only.

Change:

- Evaluate permissions through the default `build` agent when a Session omits an explicit agent, matching provider-turn execution.
- Before assembling a provider request, durably fail local tools still projected as `running` from a previous process with the existing `session.next.tool.failed` shape and `Tool execution interrupted` message.

Reason:

- Agent-less embedded Sessions previously executed as `build` while evaluating an empty permission ruleset, so the first local tool could wait forever for an approval surface the local Discord proof did not expose.
- A process lost while a local tool was running previously left a dangling tool call that made later provider continuation invalid. Recovery must settle the durable projection without replaying an abandoned side effect.

Compatibility:

- No migration, synchronized event version, OpenAPI, or SDK regeneration is required.
- Existing experimental Session databases recover dangling local-tool projections on the next provider attempt.

## 2026-06-03: V2 Skill Tool

Affected schema:

- New Core-owned `skill` model-facing tool parameters and success payload.
- Existing upstream `SkillV2` service remains the single Location-scoped skill registry.

Change:

- Accept `{ name: string }` for one skill selected from the upstream-discovered Location skill list.
- Assert `skill` permission for the selected name.
- Return V1-shaped `<skill_content name="...">` model output with the skill base directory and a bounded sampled supporting-file list.

Compatibility:

- This is an additive model-facing V2 tool contract.
- No database migration, durable-event version, public HTTP, OpenAPI, or generated SDK change is required.

## 2026-06-03: Pre-PR V2 Safety Review

Affected schema:

- V2 OpenAPI request bodies preserve requiredness instead of inheriting legacy optional-body normalization.
- Existing durable tool-failure and replay-owner schemas are reused without version changes.

Change:

- Fence replay envelopes whose aggregate ID differs from the decoded synchronized payload and persist owner claims when replay first adopts an existing unowned aggregate.
- Settle abandoned local and provider-executed tools durably before continuation; hosted failures preserve inline provider-executed replay.
- Give `apply_patch` add hunks create-only semantics, make sequential commits uninterruptible after preflight, and reject malformed patch grammar eagerly.
- Wait for initial plugin boot before materializing the `skill` built-in, discover conventional config-root skill directories, and resolve current skills again during execution.
- Sanitize provider and model public API URLs by stripping credentials, queries, and fragments.
- Keep V1-like `webfetch` network semantics: approve the requested HTTP(S) URL, allow ordinary hostnames, and delegate redirects to the HTTP transport.
- Keep V2 request bodies required in generated OpenAPI and SDK types.

Compatibility:

- No database migration is required.
- Pre-launch `session.next.*` databases remain disposable experimental state rather than compatibility targets; reset experimental V2 data when upgrading across incompatible event-schema iterations.
- V1 returns fetched images as attachments. The first Core V2 typed settlement remains text-only, so V2 continues to reject fetched images and other non-text files until attachment settlement is designed explicitly.

## 2026-06-03: Defer V2 Bash Background Execution

Affected schema:

- Core V2 model-facing `bash` tool parameters and success payload.

Change:

- Remove the optional `background` bash parameter and process-local background settlement shape from the shipped tool.
- Retain the internal `BackgroundJob` prototype for a later integration slice.

Reason:

- The model has no registered observation or cancellation tool for background bash jobs, and process-local status is not a sufficient remote contract.

Compatibility:

- Foreground V2 bash execution is unchanged.
- Reintroduce background bash only with durable status observation, completion delivery, and explicit cancellation semantics.

## 2026-06-18: Remove Bash Description Input

Affected schema:

- V1 and Core V2 model-facing `bash` tool parameters.

Change:

- Remove the V1 required and V2 optional `description` parameter.
- Derive shell presentation from the command or a generic shell label instead of model-authored description metadata.

Compatibility:

- Existing persisted tool calls may still contain `description`, but new tool definitions no longer expose or require it.
- Shell command execution behavior is unchanged.

## 2026-06-04: Add Durable Session Context Snapshots

Affected schema:

- Add `session_context_epoch` for one active immutable baseline string, structured JSON snapshot, and baseline sequence per Session.

Change:

- Lazily initialize one durable Context Epoch snapshot at the first safe provider-turn boundary.
- Lower its exact baseline string through `LLMRequest.system` for every provider turn in the epoch.
- Reuse the stored baseline verbatim after restart or producer changes instead of resampling privileged initial context.
- Compare later observations against an overwriteable codec-encoded structured snapshot rather than rendered-text hashes.
- Expose admitted chronological context as first-class `system` Session messages while keeping the active baseline in bounded context state.

Compatibility:

- The unpublished Context Epoch schema is consolidated into one database migration; baseline and structured snapshots are operational state rather than synchronized event history.
- Existing experimental V2 Session databases remain disposable across incompatible pre-launch event-schema changes.
- Chronological context updates, replacement epochs after compaction or model switches, project instructions, skills guidance, and plugin transforms remain follow-up slices.

## 2026-06-04: Admit Chronological Session Context Updates

Affected schema:

- Add synchronized `session.next.context.updated.1` Session events containing a durable System-message ID and only exact combined model-visible text.
- Add `session_context_epoch.revision` for transactional structured-snapshot advancement.
- Add the first-class `system` Session message projection for chronological context updates.

Change:

- Reconcile Location-scoped Context Sources at each safe provider-turn boundary using one coherent observation.
- Keep the stored baseline immutable while admitting changed source renderings as chronological `Message.system(...)` history.
- Advance the overwriteable structured snapshot atomically with the rendered System-message event.
- Emit the previously stored model-meaningful removal rendering when a source is removed.
- Reject chronological system updates that would split a local tool call from its result across provider protocols; use wrapped user fallback when Anthropic native system-update placement is unsupported.

Compatibility:

- The synchronized event log retains only text actually shown to the model, not internal structured snapshots.
- Existing experimental V2 Session databases remain disposable across incompatible pre-launch event-schema changes.
- Replacement epochs after compaction or model switches, skills guidance, and plugin-defined context remain follow-up slices.

## 2026-06-04: Replace Session Context Epochs Lazily

Affected schema:

- Add nullable `session_context_epoch.replacement_seq` for idempotent lazy replacement requests.

Change:

- Mark the active Context Epoch for replacement after a model switch or completed compaction projection.
- Persist the triggering aggregate sequence so same-target replay cannot reopen an already-settled replacement.
- Render and overwrite the fresh immutable baseline and structured snapshot lazily at the next safe provider-turn boundary.
- Exclude chronological System messages from earlier epochs when assembling active provider history.

Compatibility:

- Baseline replacement is bounded operational state and does not add permanent synchronized events.
- Existing experimental V2 Session databases remain disposable across incompatible pre-launch event-schema changes.
- Compaction execution, skills guidance, and plugin-defined context remain follow-up slices.

## 2026-06-05: Register Ambient System Context Producers

Affected schema:

- No database schema changes.

Change:

- Replace the Session-specific context loader with a Location-scoped registry of stable-keyed scoped context producers.
- Register environment/date and ambient instruction producers independently, then evaluate producers concurrently in stable contribution-key order.
- Directly discover and read global plus upward project `AGENTS.md` files at each safe provider-turn boundary.
- Preserve admitted instructions across transient scan/read failures and block first-epoch initialization while any context source is unavailable.
- Retry Context Epoch preparation until stable after optimistic revision mismatches.
- Clear the active Context Epoch when a Session moves so the destination initializes a complete baseline before promoting more input.
- Fence Context Epoch initialization against the authoritative Session Location so a concurrent old-Location runner cannot recreate stale privileged context after a move.
- Canonicalize ambient instruction traversal boundaries, honor `OPENCODE_DISABLE_PROJECT_CONFIG`, and make non-empty aggregate updates explicitly supersede previously loaded instructions.

Compatibility:

- Watcher-backed per-file `Refreshable` instruction observations, configured sources, nested discovery, and plugin-defined context remain follow-up slices.

## 2026-06-05: Admit Selected-Agent Skill Guidance

Affected schema:

- Add `session_context_epoch.agent` so each durable baseline records its owning effective agent.
- No synchronized event, public HTTP API, or generated SDK schema changes.

Change:

- Compose selected-agent, permission-filtered available-skill guidance with Location-wide System Context before Context Epoch admission.
- Keep skill bodies behind the existing permission-checked `skill` tool and remove the unfiltered skill list from its Location-wide definition.
- Stop missing-skill errors from enumerating the unfiltered Location-wide skill catalog.
- Bind local tool authorization and pending permission requests to the provider turn's effective agent.
- Keep absolute skill locations out of available-skill guidance; expose body and location only through the permission-checked `skill` tool.
- Request Context Epoch replacement after an agent switch, dynamically re-observe the effective agent during retries, and fence first-epoch creation against the authoritative effective agent.
- Fence existing-epoch replacement against the authoritative effective agent and block cross-agent provider turns while replacement context is unavailable.
- Group the System Context algebra, registry, and built-ins under `system-context/`; keep source producers and Context Epoch persistence with their owning Skill, instruction, and Session modules; rename projected conversation selection to Session History.
- Add the canonical V1-to-V2 runtime-context parity checklist to `specs/v2/session.md`.

Compatibility:

- Existing Context Epoch rows backfill the default `build` agent and reconcile to another selected agent at the next safe provider-turn boundary.

## 2026-06-22: Simplify Session Context Rebaselining

Affected schema:

- Remove `session_context_epoch.agent`, `session_context_epoch.replacement_seq`, and `session_context_epoch.revision`.
- No synchronized event, public HTTP API, or generated SDK schema changes.

Change:

- Sample the effective agent and model once for each provider turn; selection changes apply to the next turn.
- Preserve the immutable baseline and admit ordinary System Context changes as chronological `ContextUpdated` messages.
- Rebuild the baseline directly after completed compaction instead of maintaining pending replacement state.
- Preserve the old baseline and its effective chronological updates while a post-compaction baseline cannot be rendered completely.
- Rely on the process-local Session execution lane instead of optimistic concurrency state between Context Epoch writers.

Compatibility:

- Existing Context Epoch rows migrate in place by dropping the obsolete selection and pending-replacement columns.
- Model and agent switches no longer discard earlier chronological System Context updates by forcing a new baseline.

## 2026-09-14: Detect the Design System and Choose the Review Browser

Affected schema:

- Add optional `design.application` to configuration (V2 and V1): the project-relative application package a design targets by default; `design.system` paths are relative to it.
- Add optional `design.browser` to configuration (V2 and V1): `"default"`, a browser name or an executable path for Design review pages.
- `design` configuration sections now merge key by key across documents (`browser` independently of `system` and its `application`) instead of the most specific section replacing the whole block, matching the legacy deep merge.
- `design_document` accepts `{"action":"detect"}` (optional `input.application`); the V2 tool's output is the document list or, for detect, a text report.
- No synchronized event, database, public HTTP API route, or `Design.Info` schema changes. Generated client and SDK types and `packages/sdk/openapi.json` pick up the configuration fields.

Change:

- Detect a design system statically (component roots, global stylesheet, Tailwind version and config, framework, tsconfig aliases, target application in monorepos) with per-field confidence and evidence.
- Ask once per project (concurrent sessions share the question), through the question tool in `design_document` create/refresh (both runtimes) and a prompt in `redcode design` (not with `--attach`), whether to adopt it. Yes applies the system to the operation, then writes `design` into the project file that supplies the effective `design` section with minimal JSONC edits once the operation succeeded, verifies the effective configuration carries it, and generates `.red/DESIGN.md`; No and Edit later are recorded in user state under a lock, never in config. A project with nothing detected is not rescanned for ten minutes unless its top-level files change.
- `REDCODE_DESIGN_BROWSER` keeps precedence over `design.browser`.

Compatibility:

- Existing configurations decode unchanged; both fields are optional.

## 2026-09-15: Record the Product Files a Design Changes

Affected schema:

- Add `Design.Target` (`path`, `role` of at most 200 characters) and optional `targets` (at most 20 on update) to `Design.Update` and `Design.Info`, so `design_document` update and the design update route accept it. Paths are relative to the project root; on admission `\\` becomes `/` and empty, absolute, drive-letter, UNC and `..` paths are rejected on every OS.
- `design_exit` (both runtimes) accepts optional `noTargets`; an `existing` journey design without targets is refused before the approval question unless it is set.
- The approval summary rendered into the plan's design-owned block and the Plan/Build Design context lists the targets and an implementation contract; `design_read` section `decisions` includes them.
- No new routes, events or database migrations. Generated client and SDK types pick up the optional field.

Compatibility:

- Existing documents, approval packages and context snapshots without `targets` (and summaries without `journey`) decode unchanged and render "none recorded".

## 2026-09-16: Feedback Rounds, Note Statuses and the Round Verify

Affected schema:

- Add `Design.Round` (`number`, `opened`, `revision`, `feedback` message ids, optional `published`) and `Design.Note` (`feedback`, 1-based `index`, `round`, the `item` as the browser sent it, `status`, optional `reason` and `evidence`) with `Design.NoteStatus` (`open`, `resolved`, `partial`, `unresolved`, `accepted`) and `Design.NoteEvidence` (`job`, optional `revision`, `capture`, `findings`). `Design.Info` gains optional `rounds` and `notes`; `Design.Update` gains optional `notes` of `Design.NoteUpdate` (`feedback`, `index`, a status other than `open`, optional `reason` of at most 500 characters and `evidence.job`), at most 100 per update.
- `Design.Render.format` accepts `verify`, with optional `round` (the latest round by default). `Design.Job` gains optional `verify: Design.Verify` (`revision`, `round`, `width`, per-note `Design.VerifyNote` with `found`, `blocking`, optional `before`/`after` capture paths, `findings`, `scenarios`, one-line `reason`, and job-level `findings`).
- `Design.FeedEvent` gains the `verified` member (`design`, `revision`, `round`, `job`, per-note `verdict` of `pass`, `warn` or `fail` with a `reason`), emitted by both feeds whenever a `design_jobs` result carries a completed verify job; clients merge repeats by job id.
- `Design.FeedbackItem` moved before `Design.Info` in the module and gains optional `resent {feedback, index}` naming the note a re-sent note continues; `Design.notesOf(feedback)` names a message's review notes in rendered order (variant markers excluded).
- `GET .../job/:jobID/file` serves a verify report inline (both runtimes); other exports still download.
- No new routes or database migrations. Generated client and SDK types pick up the fields.

Change:

- `DesignStore.acknowledge` opens or extends the current round with the message's notes; `publish` records the first revision after a round's notes as its answer; `update` merges note statuses and copies the cited verify job's observation into the evidence, refusing unknown notes and jobs that are not completed verifies.
- The renderer's `verify` format locates each note by `data-design-id`, selector or XPath in its variant, parameters and screen, captures a focused crop (JPEG) before and after, runs the scenarios of the note's screen and axe/layout checks scoped to the element's container, blocks only on new serious or critical violations and new script errors relative to the before revision, gives each note its own time budget and writes the job's partial results as it goes, and writes a report with anchors per note. `DesignStore.restore` carries `rounds` and `notes` from the live document, not from the restored snapshot.

Compatibility:

- Documents, revisions and approval packages without `rounds`/`notes` decode unchanged; jobs without `verify` are unaffected.
