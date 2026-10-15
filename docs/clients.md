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
| `redcode --help`                                            | Inspect the complete command tree.                    |

**Slash commands belong in a TUI conversation**, not in your shell or Console:

| TUI command                                 | Purpose                                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/design`, `/design-open`, `/design-review` | Enter Design, resume it, or open its review.                                                                                  |
| `/goal`                                     | Start, inspect or control a goal.                                                                                             |
| `/vault`, `/monitors`, `/worktrees`         | Inspect project secrets, observations and worktrees.                                                                          |
| `/intelligence`, `/reasoning`               | Inspect evaluations or change the session's reasoning mode.                                                                   |
| `/budget`, `/compact`                       | Set an optional budget or compact context.                                                                                    |

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
