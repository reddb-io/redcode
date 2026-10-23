# Clients and the agent server

CLI, Desktop and browser are clients of an agent server. See the [component map](../README.md#components) and [installation guide](installation.md) first. Slash commands belong in a TUI conversation; shell commands run in your terminal.

## CLI

From your project directory:

```sh
redcode
```

Connect a model provider using `/connect`; configure S2 and optional S1 with `/dual` or `redcode setup`.
The normal CLI uses the local background agent server, which retains sessions when the terminal closes.
Use `--standalone` for a private server instead.

| Shell command                                               | Purpose                                               |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `redcode --tmp`                                             | Start in a temporary Git worktree.                    |
| `redcode run "Explain the project structure"`               | Send a prompt without the full TUI.                   |
| `redcode setup`                                             | Configure and check reasoning models.                 |
| `redcode vault set NAME` / `redcode vault import other.env` | Store a project secret or import an environment file. |
| `redcode service status`                                    | Inspect the local background server.                  |
| `redcode service start` / `stop` / `restart`                | Manage that server.                                   |
| `redcode session list`                                      | List sessions for the current project.                |
| `redcode stats --cost --models`                             | Inspect costs, token usage and model coverage.        |
| `redcode --help`                                            | Inspect the complete command tree.                    |

`redcode stats` produces a shareable activity report without monetary details. Add `--cost` or
`--models` to inspect spending: `~` includes estimates, `+` marks a known subtotal with unknown costs,
and `*` marks unavailable cost provenance. A zero contribution with unresolved costs appears as
`unknown`; provider-reported zero remains `$0.00`. Cost coverage counts accounting records, not
requests or invoices. `--json` preserves the API's numeric amounts and coverage metadata.

Model catalogs require models.dev V2. The committed snapshot and the sole public source use
`https://models.dev/experimental/v2.0/api.json`; configured sources must return V2 as well. Incompatible
caches are discarded, and an invalid explicitly configured file fails instead of switching sources.
There are no V1 normalizers, public V1 fallbacks or pinned compatibility aliases. Public catalog
metadata accepts only `format: 2`. Unsupported media or decision APIs remain descriptive and do not
become chat routes merely because the catalog names an SDK.

Anthropic cache writes retain observed 5-minute and 1-hour quantities. OpenAI Chat audio usage and
Gemini modality/cache detail arrays use separate billing meters. Estimates require those quantities to
reconcile with reported totals; missing cache duration, ambiguous cached audio, cache storage, unknown
rates and unmetered native-tool charges stay unknown. Provider-reported USD, including zero, takes
precedence. Token-only local overrides cannot silently cover media charges.

Mini shows the last settled step's cost, including after reconnecting or resizing; it does not show
family spending. Reported zero stays `$0.00`, estimates use `~`, known partial amounts use `+`, and
older amounts without provenance use `*`. `cost unknown` and `cost unavailable` distinguish unresolved
pricing from missing accounting. **Menu → Show status** explains the markers and scope even when
routine footer details are hidden or cannot fit. These amounts are not reconciled invoices.

**Slash commands belong in a TUI conversation**, not in your shell or Console:

| TUI command                                 | Purpose                                                     |
| ------------------------------------------- | ----------------------------------------------------------- |
| `/design`, `/design-open`, `/design-review` | Enter Design, resume it, or open its review.                |
| `/goal`                                     | Start, inspect or control a goal.                           |
| `/vault`, `/monitors`, `/worktrees`         | Inspect project secrets, observations and worktrees.        |
| `/intelligence`, `/reasoning`               | Inspect evaluations or change the session's reasoning mode. |
| `/budget`, `/compact`                       | Set an optional budget or compact context.                  |

## Desktop

With a full native installation:

```sh
redcode desktop
```

Desktop is a client of an agent server. A local connection works on this machine; a remote connection
works on the remote server's projects and filesystem. The selected server determines where tools run.
Use **Agents → Remote workers** to administer that server's permanent worker pool.
Desktop does not come with the npm package; use mise or a full release archive.
On Windows, `redcode desktop` installs the app in the user's Programs directory and adds a Start
Menu shortcut. Remove it through **Settings → Apps → Installed apps → Redcode**; session data and
settings are kept. See [installation](installation.md) for updates and distribution details.

The **Agents** view groups sessions and subagents across servers/projects, with filters, steering,
queued instructions and interruption controls. Use **Agents → Machines** to connect execution hosts and
**Agents → Remote workers** to coordinate their tasks. The CLI exposes the same pool through
`redcode workers`; see the [distributed workers guide](distributed-workers.md).

Published Design previews open beside their conversation. The embedded review keeps annotations,
feedback and approval while omitting the duplicate conversation panel. The standalone browser review
retains that panel. Both use the same session and Design revisions.

You can import local histories from OpenCode, Claude Code, Codex, Pi and oh-my-pi through the project
menu/command palette or CLI. For example:

```sh
redcode session import --from claude-code --latest
```

Imports leave source histories unchanged and report unsupported content. Importing a history is
different from synchronizing live sessions between servers.

## Models and context

CLI, Desktop and web use the same agent-server model resolver and context management. An explicit
session selection takes precedence over the default S2 model. If that selection becomes unavailable,
Redcode keeps it selected rather than silently choosing another model.

Redcode sends the selected model and connection without automatically substituting another model or
account. OpenAI-compatible gateway requests disable LiteLLM model, context-window and content-policy
fallbacks automatically, including connections created before this behavior was introduced. OpenRouter
requests restrict the model list to the selected model and disable backup-provider routing. There is
no connection setting to enable these fallbacks. Unsupported routing controls produce an error;
Redcode does not retry after removing them.

If a gateway reports a fallback or a different LiteLLM model group, Redcode rejects the response before
consuming generated text or tool calls and displays an error in CLI, Desktop and web. Same-model
retries retain the selected connection. An explicitly selected gateway alias or routing combo still
delegates its underlying deployment to that gateway; response headers cannot reveal substitutions a
gateway conceals. Operators must configure gateways to honor the requested routing controls.

Context capacity, maximum input and maximum output are separate limits. A gateway refusing a
`max_tokens` value does not establish a smaller context window. Redcode reads declared input and
output limits independently and resolves missing context information from its model catalog.
The Desktop and web Context panel separates the selected session model and its limits from the
last request that reported token usage. After switching models, the previous request's usage
remains attributed to the model that produced it.

The Context panel, header and TUI spending indicators use the server's full spending ledger for
the session and its descendants, including title, compaction and S1 calls. They mark estimates with
`~`, incomplete known subtotals with `+`, and unavailable historical provenance with `*`. Unresolved
zero contributions display as unknown; recorded provider-reported zero remains zero. These are
recorded costs and estimates, not invoice reconciliation.

ACP sends a cumulative `cost` only when its provenance is available. The `reddb.io/cost` entry in
usage-update metadata retains the known subtotal, classification and session-and-descendants scope
when a complete cost cannot be reported.

## Agent server

For an explicit foreground server on a chosen port:

```sh
redcode serve --hostname 127.0.0.1 --port 4096
```

This process serves the coding API and web interface. Keep it running while clients use it.
The managed background service normally uses port **35555**. Console normally uses **35556** on a
separate process/listener. Port **4096** in the examples is an explicitly chosen foreground-server port.

`redcode web` starts an agent server and opens its browser client. ACP uses `redcode acp`;
MCP integrations are managed through `redcode mcp`. None of these commands starts Console.

### Recovery and session execution

CLI, Desktop and web use the same server-side recovery rules. When a provider account returns a
rate limit, its requests share a cooldown on that server. Repeated upstream failures also open a
temporary circuit. After the cooldown, one request checks recovery before other sessions resume.
HTTP and WebSocket requests participate in this coordination; distinct credentials remain separate.
The existing session retry status shows the wait. A client reconnects with backoff and jitter after
losing its event stream; reconnecting does not start another execution of the session.

MCP startup admits at most four connections at a time per server. Transient startup failures and
unexpected connection closures get three recovery attempts with increasing delays. A connection
that survives for a minute resets that budget. Authentication and permanent startup errors require
an explicit correction; **Connect** or **Restart** starts a fresh recovery budget. Disconnecting cancels
pending recovery. Provider and integration catalog events refresh only catalogs already requested by
the client, avoiding plugin and MCP startup for unopened directories.

Skill discovery skips hidden and dependency directories, stops below each skill's `SKILL.md`, limits
directory depth to six and reuses unchanged watches. An exhausted native watcher enters a one-minute
cooldown before a new subscription can attempt acquisition again. Watcher failures are logged;
they do not trigger an unbounded resubscription loop.

An executing session records its owning local runtime in the database. Another process using that
database receives a `409 SessionBusyError` when it attempts execution or execution control; connect
to the original server to continue. Restart recovery skips live owners and can reclaim ownership
after a local owner exits. This protects local processes, not a cluster sharing SQLite: workers keep
independent databases, and external tool side effects can still repeat after a crash. See the
[worker execution model](distributed-workers.md).

## Usage reporting

Open **Settings → Usage reporting** for the selected server. In a multi-server installation, open
that server's Settings first. Infrastructure owner-admin access is required; organization membership
does not grant permission to configure or inspect the host reporter.

Choose a signed webhook or RedDB queue, enter its URL and credential, and enable reporting. Collection
starts when reporting is first enabled; no destination is enabled by default. Configuration is stored in the
server database and credentials use its existing credential store. A blank credential field retains
the saved value. Disable reporting to pause collection and delivery. Re-enabling resumes from the
original boundary, including retained facts from the paused interval. **Send pending reports** collects
available records and attempts delivery; **Retry** makes an unsuccessful delivery eligible again.

The reporter runs on the execution server, independently of Desktop and editor connections. Sessions
accessed through `redcode acp` use the same native accounting source, so ACP responses and notifications
are not counted a second time. A streamed chunk is not a conversation message.

Reports have a closed, versioned numeric projection: technical IDs, provider/model identifiers, message
counts/sequence, tokens, cache read/write, reasoning usage, cost, duration, first-output latency,
stream duration, retries and tool counts. No prompts, responses, reasoning text, code, commands, paths,
tool arguments/results, provider response bodies or credential values enter a report. The reporter
does not forward raw ACP frames or arbitrary metadata.

`model.usage.recorded` reports native assistant settlements, auxiliary title/compaction usage and S1
evaluations. An S1 evaluation may contain several requests; its scope is `evaluation`, not one physical
request. S1 cache/reasoning fields are `null` when unavailable. Provider/model identify the recorded
route; an opaque router's upstream is not inferred. Native `recorded` costs can come from provider usage
or the model price catalog, and are not confirmed invoices. Zero-normalized native token usage is
reported as unknown; positive recorded usage still does not prove provider-report completeness. Do not
add Redcode cost observations to a router's authoritative ledger for the same request.

`session.summary.updated` replaces the prior summary for that session when its numeric `revision` is
newer. Native summaries sum collected usage facts, including S1, and exclude inherited fork/import
usage. They describe the session itself; consumers can group descendants using `parentSessionID`.
Never add a summary to the individual records it summarizes. Context capacity/occupancy in ACP
`usage_update` is a snapshot and is not billed token consumption.

Every record has a stable `id`. The local record and outbox are committed together; failed sends use
backoff, expired sending leases recover after restart, and the receiver must deduplicate the ID
durably. Each pending delivery retains its destination and credential reference when settings change.
Pause reporting before replacing an obsolete destination if its pending deliveries must not be sent.
Delivery errors contain categories and HTTP status codes, not response text.
**Retry** retains the original destination and credential. **Retry with current destination** explicitly
rebinds an unsuccessful delivery to the saved URL, transport and credential; its record ID and payload
stay unchanged. Use it after correcting a destination or rotating its credential.

Webhooks send the JSON record with `webhook-id`, `webhook-timestamp`, `webhook-signature` and
`idempotency-key`. Verify HMAC-SHA256 over `<id>.<timestamp>.<body>` and deduplicate after signature
validation. Signing keys accept a `whsec_` base64 value or a literal secret of at least 16 characters.
HTTPS is required except for loopback development destinations, and redirects are refused.

For RedDB, configure the server's base URL and an existing queue, for example:

```sql
CREATE QUEUE IF NOT EXISTS usage_events WITH DEDUP_WINDOW 1h
```

The reporter sends `QUEUE PUSH ... DEDUP '<record id>'` through `/query`. Queue deduplication has a
bounded window; retain a permanent unique record ID in the final consumer as well.

This reporter measures observed model usage, not tenant-isolated infrastructure consumption. Missing
usage is `null`, partial pricing is marked with `unpricedRecords`, and process death can leave upstream
consumption unreported. Collection depends on durable source events remaining available until the
collector runs. Keep the database/outbox on durable storage and drain it before destroying a worker.
OS resource enforcement, per-session CPU/RAM metering and provider-invoice reconciliation remain
separate concerns.
