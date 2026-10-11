<div align="center">

<img src="docs/hero.svg" alt="Redcode coding agent with CLI, Desktop, Design and remote workers" width="100%" />

<p>
  <a href="https://www.npmjs.com/package/@reddb-io/redcode"><img src="https://img.shields.io/npm/v/%40reddb-io%2Fredcode?style=for-the-badge&label=npm&color=ff2056&labelColor=0d1117" alt="npm version"></a>
  <a href="https://github.com/reddb-io/redcode/actions/workflows/redcode.yml"><img src="https://img.shields.io/github/actions/workflow/status/reddb-io/redcode/redcode.yml?branch=main&style=for-the-badge&label=CI&labelColor=0d1117" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge&labelColor=0d1117" alt="License"></a>
</p>

<strong>An open-source coding agent for the terminal and desktop.</strong><br>
Work locally, connect to another machine, or distribute tasks across your own workers.

</div>

---

[Components](#components) · [Install](#install) · [CLI](#cli) · [Desktop](#desktop) · [Agent server](#agent-server) · [Remote access](#remote-access) · [Workers](#workers) · [Console](#console) · [Features](#features) · [Documentation](#documentation) · [Development](#development)

Redcode is built on [OpenCode](https://github.com/anomalyco/opencode), with additions for project secrets,
S1/S2 reasoning, autonomous goals, Design review, infrastructure administration and distributed tasks.
Attribution is preserved in [NOTICE](NOTICE). The [parity ledger](docs/opencode-parity-ledger.json)
records what has been reviewed and implemented; full OpenCode feature parity is still incomplete.

## Components

“Server” and “worker” describe different responsibilities. Most of them use the same `redcode` executable.

| Component | What it does | How you use it |
| --- | --- | --- |
| **CLI / TUI** | Terminal client, commands and interactive coding sessions. | `redcode`, `redcode run`, `redcode --help` |
| **Desktop** | Electron application for projects, conversations, server connections and agent management. | `redcode desktop` from a full installation |
| **Agent server** | Owns sessions, provider connections, tools, terminals and files on its host. Serves the V2 API and web client. The CLI's background service runs this server too. | `redcode serve` or `redcode service` |
| **Worker coordinator** | An agent server that stores a remote-worker registry, dispatches batches and collects their results. Continues when its Desktop/browser client closes. | **Agents → Remote workers** on the selected server |
| **Remote Redcode worker** | Another agent server with its own database, provider configuration and independent checkout. Executes assigned agent tasks. | `redcode serve` on each worker host |
| **Console** | Separate administration web app for accounts, organizations, workspaces, keys, authentication, infrastructure ownership and workspace grants. | `redcode console serve` |
| **Design review** | Prototype and annotation UI attached to a coding session. Its renderer runs as a child process of the same executable. | `redcode design`, `/design-review`, or the server's `/design` page |
| **RedSkills fleet** | Optional integration with the separate `redskilled` daemon. Its local fleet controls are distinct from distributed Redcode tasks. | TUI `/workers`; [RedSkills](https://github.com/reddb-io/red-skills) |

A typical distributed setup looks like this:

<img src="docs/architecture.svg" alt="CLI, Desktop and browser connect to the agent server; the coordinator distributes tasks to independent worker servers and checkouts; Console provides optional delegated authorization" width="100%" />

Each worker executes its own sessions. The coordinator tracks assignments; it does not share a Session
database with workers. Console authentication and agent-server credentials are separate.
The source's `workerd` profile targets **Cloudflare Durable Objects**; it is not the daemon for Raspberry Pi workers.

## Install

Choose the distribution for the machine's role:

| Installation | Included | Best fit |
| --- | --- | --- |
| `npm install -g @reddb-io/redcode` | CLI/TUI, agent server, Console, embedded Design and RPC sidecar; no Desktop. | Terminal users and server hosts with npm |
| `mise use -g github:reddb-io/redcode@latest` | Full native distribution, including Desktop where supported. | Workstation installation without Node |
| Full native release archive | Same full distribution; Desktop under `desktop/` beside `redcode`. | Manual workstation installation |
| `redcode-server-<target>` release archive | Same CLI/agent engine, Console, Design and sidecar, without Electron. | Coordinators, remote workers and headless hosts |

Download archives from [Releases](https://github.com/reddb-io/redcode/releases). Windows uses ZIP;
Linux and macOS use `tar.gz`. Verify them against the release's `SHA256SUMS` and keep one installation
method per machine. Desktop is included on Windows, macOS and Linux glibc; Linux musl archives omit it.

On x64, npm selects one compatible baseline binary. Linux packages declare glibc or musl;
optimized x64 variants remain available in release archives. Linux ARM64 is a build target;
32-bit ARM/Raspberry Pi OS is unsupported. Physical Pi execution still needs device acceptance.
Design shares Redcode's native executable, so there is no separate native Design package to install.

## CLI

From your project directory:

```sh
redcode
```

Connect a model provider using `/connect`; configure S2 and optional S1 with `/dual` or `redcode setup`.
The normal CLI uses the local background agent server, which retains sessions when the terminal closes.
Use `--standalone` for a private server instead.

| Shell command | Purpose |
| --- | --- |
| `redcode --tmp` | Start in a temporary Git worktree. |
| `redcode run "Explain the project structure"` | Send a prompt without the full TUI. |
| `redcode setup` | Configure and check reasoning models. |
| `redcode vault set NAME` / `redcode vault import other.env` | Store a project secret or import an environment file. |
| `redcode service status` | Inspect the local background server. |
| `redcode service start` / `stop` / `restart` | Manage that server. |
| `redcode session list` | List sessions for the current project. |
| `redcode --help` | Inspect the complete command tree. |

**Slash commands belong in a TUI conversation**, not in your shell or Console:

| TUI command | Purpose |
| --- | --- |
| `/design`, `/design-open`, `/design-review` | Enter Design, resume it, or open its review. |
| `/goal` | Start, inspect or control a goal. |
| `/vault`, `/monitors`, `/worktrees` | Inspect project secrets, observations and worktrees. |
| `/intelligence`, `/reasoning` | Inspect evaluations or change the session's reasoning mode. |
| `/budget`, `/compact` | Set an optional budget or compact context. |
| `/workers` | Inspect the local **RedSkills** fleet. For remote Redcode tasks, use the Workers section below. |

## Desktop

With a full native installation:

```sh
redcode desktop
```

Desktop is a client of an agent server. A local connection works on this machine; a remote connection
works on the remote server's projects and filesystem. The selected server determines where tools run.
Use **Agents → Remote workers** to administer that server's permanent worker pool.
Desktop does not come with the npm package; use mise or a full release archive.

The **Agents** view groups sessions and subagents across servers/projects, with filters, steering,
queued instructions and interruption controls. Its RedSkills Workers tab and Remote workers panel
serve the two different fleet models described above.

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

## Remote access

To use your existing background agent server from another device, run on the host:

```sh
redcode pair --remote
```

This enables an HTTPS tunnel for the managed service and prints one-time pairing links. It can restart
the service when enabling the tunnel. Open a link on the other device to connect its browser;
links expire and work once. Pairing grants access to the agent host, so reserve it for trusted operators.
For your own externally reachable server address, use `redcode pair --url https://agent.example.org`.

An SSH tunnel is another option: forward the host's agent-server port, then open its pairing link
through the forwarded address. See [remote access recipes](docs/remote-access.md).
Coding remotely keeps execution and files on the host; connecting another PC does not copy its
repositories, credentials or full session database between machines.

## Workers

### Add workers to the server

The permanent pool belongs to the **coordinator agent server**, not to the Desktop client or Console.
No extra “master” binary is required. Each worker runs the same Redcode agent server.

1. Install Redcode on the coordinator and each worker, preferably with matching versions. Server archives avoid installing Electron on workers.
2. Prepare an independent checkout on each worker and connect a model provider there. Use `redcode auth login` on that host or `/connect` through its connected client.
3. On a Linux worker, start an authenticated server from its checkout:

   ```sh
   cd /home/worker/project
   export REDCODE_PASSWORD='replace-with-a-private-worker-password'
   redcode serve --hostname 0.0.0.0 --port 4096
   ```

   `0.0.0.0` allows network connections. Prefer an HTTPS endpoint or SSH forward for the connection; a private LAN address is useful for local testing.
4. Connect Desktop to the coordinator. Open **Agents → Remote workers** and register the worker ID, reachable URL, absolute checkout path, password/pairing token and optional tags such as `linux, arm64`. Use **Check connection** to confirm the host and authentication.
5. Add independent tasks, select their workers or let the coordinator choose available slots, and **Send batch**. For tasks waiting on a permission or input request, open that worker's Session in a normal client.
6. Use **Review changes** to collect the completed task's patch. Review it before applying it to your project. Collect results before removing a worker.

One checkout is one execution slot. Different slots run concurrently; tasks assigned to the same slot
run sequentially. The permanent coordinator currently accepts one unfinished batch at a time.
Restart recovery retains original Session/admission IDs; ambiguous tasks require explicit recovery
on their original worker. Automatic failover, checkout synchronization and binary/commit transfer
remain separate work. Do not share SQLite databases between worker hosts.

For delegated organization users, an infrastructure administrator also registers resources and
workspace grants in Console. See [infrastructure access](docs/console-infrastructure.md);
registering a resource in Console alone does not add it to the coordinator's pool.

### Coordinate from the CLI

`redcode workers add` maintains a **CLI registry file**. It does not change the permanent server-owned
pool above. Use this path for script-driven batches:

```powershell
$env:WORKER_A_PASSWORD = 'replace-with-a-private-worker-password'
redcode workers add worker-a --config .\workers.json --url http://192.168.1.50:4096 --directory /home/worker/project --password-env WORKER_A_PASSWORD --tag linux
redcode workers list --config .\workers.json
redcode workers run .\tasks.json --config .\workers.json --report .\tasks.run.json --timeout 300
```

Create `tasks.json` first:

```json
{
  "tasks": [
    { "id": "linux-tests", "worker": "worker-a", "prompt": "Run the Linux tests and report failures." }
  ]
}
```

Keep the registry and report: they retain placement and admission IDs for observation/recovery.
`--timeout` limits observation, not execution. Repeating `run` with the same inputs observes assigned
sessions. `redcode workers collect` exports text patches and a result report without applying changes.
The [distributed workers guide](docs/distributed-workers.md) covers multiple workers, tags, recovery,
artifact collection, Raspberry Pi prerequisites and the Docker acceptance lab.

## Console

Start the administration app separately:

```sh
redcode console serve --port 35556
```

Open `http://127.0.0.1:35556`. On the first run, use the **setup code printed in the terminal** to create
the first account. It receives separate organization-owner and infrastructure-admin memberships.
Console binds to loopback; publish it remotely through an HTTPS reverse proxy or tunnel.
You can run it locally without a domain.

Its siderail separates **Infrastructure**, **Organization**, **Workspace** and **Account** scopes.
Infrastructure administrators own the servers/workers and grant workspace access. Organization owners
and admins manage their organization; those roles do not make them owners of the host infrastructure.
Infrastructure users and organization members can submit/review tasks within their granted scope.
See the [role and delegation rules](docs/console-infrastructure.md).

Configure authentication in **onboarding or Console settings**, with any compatible OIDC provider:

- **Infrastructure → Global authentication:** shared providers available across organizations.
- **Infrastructure → Owner authentication:** providers for infrastructure access.
- **Organization → Authentication settings:** that organization's own providers.

Set the public Console URL, issuer, client ID and any required secret in those screens. Console discovers
the OIDC endpoints and shows its callback URL. Sign-in redirects to the selected configured IdP and
returns to Console. Global provider availability does not automatically create organization membership;
invitation and identity-linking rules still apply. See [federation setup](docs/console-federation.md).

Console can authorize delegated worker batches when an agent server is bound to its registered resource.
These grants do not yet provide tenant-isolated interactive terminals or an OS sandbox. Hosted billing,
gateway services, SCIM and full SaaS isolation remain incomplete; see the [parity ledger](docs/opencode-parity-ledger.json).

## Features

### Modes

Coding sessions use Build, Plan, Design or Question. In the TUI, `Tab` cycles agents and `Shift+Tab`
goes back. These are session modes, separate from Console roles and worker placement.

<img src="docs/features/build.svg" alt="Build mode" width="100%" />

**Build** reads, edits, runs and delegates to subagents under the configured permissions.

<img src="docs/features/plan.svg" alt="Plan mode" width="100%" />

**Plan** explores and writes the plan before implementation. `plan_exit` asks whether to switch to Build.

<img src="docs/features/design.svg" alt="Design mode" width="100%" />

**Design** works on an interactive prototype while keeping product code separate. The review and
approved decisions feed the plan. See [Design mode](#design-mode).

<img src="docs/features/question.svg" alt="Question mode" width="100%" />

**Question** investigates the codebase with read-only tools. [Mode details](docs/agent-features.md#modes).

### Vault

<img src="docs/features/vault.svg" alt="Per-project secret vault" width="100%" />

The model works with references such as `{vault:github-token}`. The harness resolves values when a
tool needs them and redacts known secrets from output. Secrets stay scoped to the project; worktrees
share its `.env`. Use `/vault`, `redcode vault set NAME` or `redcode vault import other.env`.
[Vault behavior](docs/agent-features.md#vault).

### S1 · S2 dual reasoning

<img src="docs/features/intelligence.svg" alt="S1 and S2 dual reasoning" width="100%" />

S2 does the agent work; optional S1 evaluations check candidates and provide feedback. `/dual` configures
the models, `/intelligence` shows evaluations, and `/reasoning` changes the session mode. An unavailable
or inconclusive evaluation is shown as such. Coding studies have not demonstrated an accuracy or speed
gain; keep the [measurements and limitations](docs/evaluations/reasoning-0.71.3-2026-10-02.md) alongside
the [reasoning roles](docs/system-one.md) and [full explanation](docs/agent-features.md#s1--s2-dual-reasoning).

### Goal

<img src="docs/features/goal.svg" alt="Autonomous goals with completion criteria" width="100%" />

`/goal` keeps a session working across turns toward a defined outcome. Add verification gates,
constraints and stopping conditions; use `/goal-pause`, `/goal-resume` and `/goal-drop` to control it.
The harness checks completion instead of relying only on the agent's claim.
[Goal contract and examples](docs/agent-features.md#goal).

### Design mode

<img src="docs/features/design-flow.svg" alt="Design workflow: describe, prototype, preview, annotate, send feedback, revise, plan and build" width="100%" />

Prototype a web interface, an app or presentation slides. The agent reads `DESIGN.md` or `.red/DESIGN.md`
and reuses the project's design system. Explore revisions, annotate elements, audit layout and edit
Mermaid content through the optional whiteboard. Your queued notes reach the agent when you press
**Send to Agent**; approval records decisions for Plan and Build.

<img src="docs/features/design-review.svg" alt="Standalone Design browser review with annotation pins and queued feedback" width="100%" />

Desktop embeds the review beside the chat and omits its duplicate conversation panel. The standalone
browser review keeps that panel. Both use the same Design session, revisions and feedback. The renderer
runs as a child process of the same executable. [Complete Design workflow](docs/agent-features.md#design-mode).

### RedRouter

<img src="docs/features/router.svg" alt="RedRouter provider connections" width="100%" />

RedRouter exposes models through a key-scoped catalog, with automatic routing, pinned offers and MCP
tools. `/connect` also manages multiple connections for other supported providers; select S2 and
optional S1 through `/dual`. [Provider behavior](docs/agent-features.md#redrouter).

### Monitors

<img src="docs/features/monitors.svg" alt="Session background monitors" width="100%" />

Monitors observe HTTP endpoints, files or processes while the session works. `/monitors` shows their
state; completion can wake the session while respecting newer instructions and paused goals.
[Monitor behavior](docs/agent-features.md#monitors).

### Local RedSkills fleet

<img src="docs/features/workers.svg" alt="Local RedSkills worker fleet" width="100%" />

The optional `redskilled` integration shows project worker activity and controls such as drain, stop
and status. Its daemon owns that fleet. TUI `/workers` and the Desktop Workers tab refer to this
integration; **Agents → Remote workers** manages the separate [distributed Redcode pool](#workers).
[RedSkills integration](docs/agent-features.md#local-redskills-fleet).

### Stop-loss and loop guard

<img src="docs/features/stop-loss.svg" alt="Stop-loss and loop guard" width="100%" />

The loop guard detects repeated calls with the same result; stop-loss detects spending without
progress. There are no default cost limits. `/budget` adds a spend/token limit when requested.
[Session guards](docs/agent-features.md#stop-loss-and-loop-guard).

### Compaction

<img src="docs/features/compaction.svg" alt="Focused compaction with preserved anchors" width="100%" />

`/compact` accepts a focus and retains important user messages and decisions. Summaries pass through
the vault's redaction; `/restricted` manages content marked as restricted.
[Compaction details](docs/agent-features.md#compaction).

### Worktrees and the background service

<img src="docs/features/worktrees.svg" alt="Git worktrees and the background agent service" width="100%" />

`redcode --tmp` uses a temporary Git worktree. `/worktrees` or `redcode worktrees` manages project
checkouts. The background agent server retains sessions when the terminal closes; inspect and control
it with `redcode service`. [Worktree and service behavior](docs/agent-features.md#worktrees-and-the-background-service).

### Dictation

<img src="docs/features/voice.svg" alt="Structured voice dictation" width="100%" />

The composer accepts structured dictation from [dit](https://github.com/reddb-io/dit). Partial text is
replaceable and completed dictation stays as an editable draft; voice input never submits it.
[Voice input](docs/voice-input.md).

The [feature guide](docs/agent-features.md) retains the detailed contracts and evaluation evidence.

## Documentation

| I want to… | Read |
| --- | --- |
| Code on another machine | [Remote access recipes](docs/remote-access.md) |
| Add workers, dispatch batches, recover and review patches | [Distributed workers](docs/distributed-workers.md) |
| Use Raspberry Pi workers or simulate workers with Docker | [Pi prerequisites](docs/distributed-workers.md#raspberry-pi-prerequisites), [Docker lab](docs/distributed-workers.md#docker-acceptance-lab) |
| Separate infrastructure owners from organization users | [Infrastructure access](docs/console-infrastructure.md) |
| Configure global, owner or organization OIDC | [Console federation](docs/console-federation.md) |
| Understand coding and Design features | [Agent feature guide](docs/agent-features.md) |
| Track OpenCode V2 adoption and remaining work | [Migration/parity notes](docs/migration-parity.md), [feature ledger](docs/opencode-parity-ledger.json) |
| Build and publish Redcode | [CI/CD](docs/ci-cd.md) |

## Development

Current implementation lives in `packages/core`, `packages/cli`, `packages/tui`, `packages/server`,
`packages/protocol` and `packages/schema`. The web application is in `packages/app`; Electron integration
is in `packages/desktop`; Design is in `packages/design-app`; `packages/redcode` packages the product.
Internal `@opencode/*` names preserve the upstream architecture and do not change the published product name.

`main` is the development branch. Use Bun's version from `package.json` and run `bun install`, then
`bun run check` for lint and type checking. Tests run from package directories, never the repository root.
Regenerate the client with `bun run generate` in `packages/client` after changing the public API.
README artwork is generated: `bun script/readme/banners.ts` rewrites `docs/hero.svg`, `docs/architecture.svg`
and `docs/features/*.svg`.

## Releases

Publish through the [redcode workflow](https://github.com/reddb-io/redcode/actions/workflows/redcode.yml):

```sh
gh workflow run redcode.yml --repo reddb-io/redcode --ref main -f publish=true
```

The workflow runs checks and tests, builds full and server native archives, verifies embedded Design,
archive contents, installation and checksums, and publishes npm packages and GitHub releases.
The npm distribution contains CLI and embedded Design; Desktop is shipped through full native archives.
Changesets record release intent for `@reddb-io/redcode`; versioning and publishing run directly from `main`.
See [CI/CD](docs/ci-cd.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
