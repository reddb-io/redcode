<div align="center">

<img src="docs/hero.svg" alt="Redcode — terminal and desktop coding agent" width="100%" />

<p>
  <a href="https://www.npmjs.com/package/@reddb-io/redcode"><img src="https://img.shields.io/npm/v/%40reddb-io%2Fredcode?style=for-the-badge&label=npm&color=ff2056&labelColor=0d1117" alt="npm version"></a>
  <a href="https://github.com/reddb-io/redcode/actions/workflows/redcode.yml"><img src="https://img.shields.io/github/actions/workflow/status/reddb-io/redcode/redcode.yml?branch=main&style=for-the-badge&label=CI&labelColor=0d1117" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge&labelColor=0d1117" alt="License"></a>
</p>

<strong>An open-source coding agent for your own machines.</strong><br>
Work in the terminal or Desktop, review prototypes beside your conversation,<br>
and send independent tasks to your own remote workers.

<p><a href="#get-started">Get started</a> · <a href="#session-modes">Modes</a> · <a href="#features">Features</a> · <a href="#remote-execution">Remote hosts & workers</a> · <a href="#console">Console</a> · <a href="#documentation">Documentation</a></p>

</div>

<img src="docs/screenshots/workspace.png" alt="Redcode web workspace showing a demo planning conversation, session tabs and the composer" width="100%" />

*A demo planning conversation in the web workspace shared with Desktop.*

Redcode builds on [OpenCode](https://github.com/anomalyco/opencode), adding project secrets,
S1/S2 reasoning, goals, Design review and worker administration. Attribution is preserved in [NOTICE](NOTICE).

## Get started

<img src="docs/sections/get-started.svg" alt="01: Get started — open your first workspace" width="100%" />

### Desktop

Install the full distribution with [mise](docs/installation.md), or download a **full native archive**
from [Releases](https://github.com/reddb-io/redcode/releases). From your project directory:

```sh
mise use -g github:reddb-io/redcode@latest
redcode desktop
```

Desktop brings conversations, session/subagent management and Design review into one workspace.
Choose a local or remote agent server, then use **Connect provider** to configure a model and start a conversation.

### CLI / TUI

Install with npm, then run from your project directory:

```sh
npm install -g @reddb-io/redcode
redcode
```

Use `/connect` to add a model provider, then start a conversation. `/dual` or `redcode setup`
configures S2 and optional S1. Slash commands run **inside the TUI**; `redcode ...` commands run in your shell.

The npm package includes the agent engine, Console and Design. **Desktop requires the full distribution.**
See [installation and platforms](docs/installation.md) and [client commands](docs/clients.md).
Installing a headless host? Go to [remote hosts and workers](#remote-execution).

## Session modes

<img src="docs/sections/session-modes.svg" alt="02: Session modes — choose how the agent works" width="100%" />

Choose the agent's job for the conversation. In the TUI, `Tab` cycles modes and `Shift+Tab` goes back.

### Build

<img src="docs/features/build.svg" alt="Build mode" width="100%" />

Reads, edits, runs and delegates to subagents under your configured permissions.

### Plan

<img src="docs/features/plan.svg" alt="Plan mode" width="100%" />

Explores the project and writes a plan before implementation. `plan_exit` asks whether to switch to Build.

### Design

<img src="docs/features/design.svg" alt="Design mode" width="100%" />

Creates an interactive prototype while keeping product code separate. Review decisions feed the plan.
See [prototyping and review](#prototyping-and-review).

### Question

<img src="docs/features/question.svg" alt="Question mode" width="100%" />

Investigates the codebase with read-only tools. [Mode details](docs/agent-features.md#modes).

---

## Features

<img src="docs/sections/features.svg" alt="03: Features — tools for your coding sessions" width="100%" />

**Session engine** features run on the agent server behind your client. **CLI/TUI**, **Desktop** and
**browser** labels identify controls or review interfaces; optional integrations are named explicitly.

[Secrets & safeguards](#secrets-and-safeguards) · [Autonomy & monitoring](#autonomy-and-monitoring) ·
[Context & sessions](#context-and-sessions) · [Prototyping & integrations](#prototyping-and-integrations)

### Secrets and safeguards

#### Vault

<img src="docs/features/vault.svg" alt="Per-project secret vault" width="100%" />

**Session engine · CLI/TUI management.** The model uses references such as `{vault:github-token}`;
tools resolve the value when needed and redact known secrets from output. Secrets belong to the project.
Use `/vault` or `redcode vault`. [Behavior and storage](docs/agent-features.md#vault).

#### Stop-loss and loop guard

<img src="docs/features/stop-loss.svg" alt="Stop-loss and loop guard" width="100%" />

**Session engine.** Detects repeated tool results and spending without progress. TUI `/budget` adds an
optional spend/token limit; no cost limit is imposed by default. [Session guards](docs/agent-features.md#stop-loss-and-loop-guard).

---

### Autonomy and monitoring

#### S1 · S2 dual reasoning

<img src="docs/features/intelligence.svg" alt="S1 and S2 dual reasoning" width="100%" />

**Session engine · TUI controls.** S2 does the work; optional S1 evaluates candidates and provides feedback.
Configure with `/dual` and inspect with `/intelligence`. Coding studies have not demonstrated an accuracy
or speed gain. [Roles](docs/system-one.md) · [Measurements](docs/evaluations/reasoning-0.71.3-2026-10-02.md).

#### Goal

<img src="docs/features/goal.svg" alt="Autonomous goals with completion criteria" width="100%" />

**Session engine · TUI controls.** `/goal` pursues an outcome across turns with verification gates and
stopping conditions. Pause, resume or drop it with `/goal-pause`, `/goal-resume` and `/goal-drop`.
[Goal contract](docs/agent-features.md#goal).

#### Monitors

<img src="docs/features/monitors.svg" alt="Session background monitors" width="100%" />

**Session engine · TUI controls.** Observes HTTP endpoints, files or processes while the session works.
Completion can wake the agent while respecting newer instructions and paused goals. `/monitors` shows
the observations. [Monitor behavior](docs/agent-features.md#monitors).

---

### Context and sessions

#### Compaction

<img src="docs/features/compaction.svg" alt="Focused compaction with preserved anchors" width="100%" />

**Session engine.** TUI `/compact` accepts a focus and retains important messages and decisions.
Summaries use the vault's redaction; `/restricted` manages restricted content.
[Compaction details](docs/agent-features.md#compaction).

#### Worktrees and the background service

<img src="docs/features/worktrees.svg" alt="Git worktrees and the background agent service" width="100%" />

**CLI/TUI · agent server.** `redcode --tmp` starts in a temporary Git worktree; `/worktrees` or
`redcode worktrees` manages checkouts. The background server retains sessions when the terminal closes.
Inspect it with `redcode service`. [Worktrees and service](docs/agent-features.md#worktrees-and-the-background-service).

Histories from OpenCode, Claude Code, Codex, Pi and oh-my-pi can be imported through Desktop or CLI.
Import preserves the source history. [Import commands](docs/clients.md#desktop).

---

### Prototyping and integrations

<a id="design-mode"></a>

#### Prototyping and review

<img src="docs/features/design-flow.svg" alt="Design workflow: describe, prototype, review, plan and build" width="100%" />

**Design mode · Desktop/browser review.** Prototype interfaces or slides using the project's design
system. Annotate elements, compare revisions and send queued feedback with **Send to Agent**.
Approval records decisions for Plan and Build.

<img src="docs/features/design-review.svg" alt="Standalone Design review with annotation pins and queued feedback" width="100%" />

Desktop embeds the review beside the chat. Standalone browser review includes its conversation panel.
[Complete workflow](docs/agent-features.md#design-mode).

#### RedRouter

<img src="docs/features/router.svg" alt="RedRouter provider connections" width="100%" />

**Optional model provider · agent server.** Offers a key-scoped model catalog, automatic routing,
pinned offers and MCP tools. TUI `/connect` manages provider connections; `/dual` selects S2 and optional S1.
[Provider behavior](docs/agent-features.md#redrouter).

#### Local RedSkills fleet

<img src="docs/features/workers.svg" alt="Local RedSkills worker fleet" width="100%" />

**Optional `redskilled` integration · TUI/Desktop.** Shows that daemon's project workers and fleet controls.
TUI `/workers` and the Desktop Workers tab refer to RedSkills; **Agents → Remote workers** manages the
separate [Redcode worker pool](#add-workers-to-the-coordinator). [Integration details](docs/agent-features.md#local-redskills-fleet).

#### Dictation

<img src="docs/features/voice.svg" alt="Structured voice dictation" width="100%" />

**TUI · optional dit integration.** Structured dictation stays as an editable draft and never submits
the composer. Unix uses a local socket; Windows retains dit's existing input injection.
[Voice input](docs/voice-input.md).

## Remote execution

<img src="docs/sections/remote-execution.svg" alt="04: Remote execution — connect devices and add workers" width="100%" />

Connect another device to the machine holding your project, or give independent tasks to multiple hosts.
For a headless coordinator or worker, install a `redcode-server-<target>` archive from
[Releases](https://github.com/reddb-io/redcode/releases). It includes the CLI/agent engine without Electron.

### Components

| Component | What it does |
| --- | --- |
| **CLI/TUI, Desktop, browser** | Clients for conversations, review and controls. |
| **Agent server** | Runs sessions, models, tools, terminals and file access on its host. |
| **Coordinator** | An agent server with a worker registry; dispatches batches and collects results. |
| **Remote worker** | An agent server with its own database, providers and checkout. |
| **Console** | Separately manages identity, organizations and resource access. |

<img src="docs/architecture.svg" alt="Clients connect to an agent server; its coordinator dispatches to independent workers; Console optionally authorizes delegated access" width="100%" />

Coordinators and workers both run `redcode serve`. The selected server determines where files and tools live.

### Connect from another device

On the host with your projects:

```sh
redcode pair --remote
```

This enables the background service's HTTPS tunnel and prints expiring one-time links. Open a link on
the other device. Pairing grants trusted host access; enabling the tunnel can restart the service.
[Pairing, SSH and foreground servers](docs/remote-access.md).

### Add workers to the coordinator

Each worker needs a matching Redcode version, its own checkout and a configured model provider.
On a Linux worker:

```sh
cd /home/worker/project
export REDCODE_PASSWORD='replace-with-a-private-worker-password'
redcode serve --hostname 0.0.0.0 --port 4096
```

In Desktop connected to the **coordinator**:

1. Open **Agents → Remote workers**. Add the reachable address, checkout path and credential; use **Check connection**.
2. Add independent tasks, select workers or allow placement on available slots, then **Send batch**.
3. Use **Review changes** to collect finished patches before applying them.

Each checkout is one execution slot. Different slots run concurrently; tasks within a slot run sequentially.
The coordinator continues when Desktop closes and accepts one unfinished batch at a time.

CLI `redcode workers add`, `run`, `recover` and `collect` uses a separate registry file.
The [worker guide](docs/distributed-workers.md) covers that flow, permission requests, recovery and a
[Docker lab](docs/distributed-workers.md#docker-acceptance-lab).

Checkouts are not synchronized automatically, and ambiguous tasks recover on the original worker.
Physical Raspberry Pi ARM64 execution still needs device acceptance. [Pi prerequisites](docs/distributed-workers.md#raspberry-pi-prerequisites).
The repository's Cloudflare `workerd` profile is separate from this pool.

## Console

<img src="docs/sections/console.svg" alt="05: Console — administer identity and resource access" width="100%" />

Console is the administration interface. Its siderail separates **Infrastructure**, **Organization**,
**Workspace** and **Account**. Start it independently of the coding server:

```sh
redcode console serve --port 35556
```

Open `http://127.0.0.1:35556`. First-run onboarding uses the **setup code printed in the terminal**
and creates the initial infrastructure administrator and organization owner. No domain is needed locally;
remote administration uses an HTTPS reverse proxy or tunnel.

### Ownership and organization access

| Scope | Authority |
| --- | --- |
| **Infrastructure admin** | Administers servers, workers, infrastructure membership and resource grants. |
| **Infrastructure user** | Submits and reviews their tasks on allowed resources. |
| **Organization owner / admin** | Manages organization membership and workspaces. |
| **Organization member** | Submits and reviews their tasks within an authorized workspace. |

Organization roles do not confer infrastructure authority. Register resources and grant worker checkouts
to workspaces in Console; adding a resource here does not add it to the coordinator's pool.
[Resource access and delegation](docs/console-infrastructure.md).

### Your own authentication provider

Configure a compatible OIDC provider during onboarding or through settings:

| Settings | Provider scope |
| --- | --- |
| **Infrastructure → Global authentication** | Shared across organizations. |
| **Infrastructure → Owner authentication** | Infrastructure access. |
| **Organization → Authentication settings** | That organization's authentication. |

Console discovers issuer endpoints and displays the callback URL. Login redirects to the selected IdP;
invitations and identity-linking rules determine membership. [Configuration and login flow](docs/console-federation.md).

Delegated batches are supported. Tenant-isolated interactive terminals, OS sandboxing and full hosted
SaaS services remain incomplete. [Implementation status](docs/opencode-parity-ledger.json).

<a id="guides"></a>

## Documentation

<img src="docs/sections/guides.svg" alt="06: Documentation — choose a guide for your task" width="100%" />

| You want to… | Read |
| --- | --- |
| Install Desktop, CLI or a headless server | [Installation and platforms](docs/installation.md) |
| Use client commands or import histories | [Clients and commands](docs/clients.md) |
| Explore modes and session features | [Agent features](docs/agent-features.md) |
| Connect from another computer | [Remote access](docs/remote-access.md) |
| Register workers, dispatch tasks and collect patches | [Distributed workers](docs/distributed-workers.md) |
| Prepare Raspberry Pis or simulate workers | [Pi prerequisites](docs/distributed-workers.md#raspberry-pi-prerequisites) · [Docker lab](docs/distributed-workers.md#docker-acceptance-lab) |
| Delegate infrastructure or organization access | [Infrastructure access](docs/console-infrastructure.md) |
| Configure global, owner or organization login | [Console federation](docs/console-federation.md) |
| Understand reasoning and its measurements | [S1/S2 roles](docs/system-one.md) · [Evaluation evidence](docs/evaluations/reasoning-0.71.3-2026-10-02.md) |
| Use dictation | [Voice input](docs/voice-input.md) |
| Follow OpenCode adoption and remaining work | [Migration notes](docs/migration-parity.md) · [Parity ledger](docs/opencode-parity-ledger.json) |

## Contributing

<img src="docs/sections/contributing.svg" alt="07: Contributing — build, verify and publish" width="100%" />

| Repository area | Packages |
| --- | --- |
| **Agent runtime and API** | `core`, `server`, `protocol`, `schema`, `client` |
| **Clients and Design** | `cli`, `tui`, `app`, `desktop`, `design-app`, `session-ui` |
| **Distribution** | `redcode`, `rpc-sidecar` |

Internal `@opencode/*` names preserve the upstream architecture; development happens on `main`.
Use the Bun version in `package.json`, run `bun install`, then `bun run check`. Run tests from package
directories. Public API changes require `bun run generate` in `packages/client`.

SVG artwork comes from `bun script/readme/banners.ts`; edit the generator. Releases use Changesets
and the [Redcode workflow](https://github.com/reddb-io/redcode/actions/workflows/redcode.yml).
[Build and publishing guide](docs/ci-cd.md) · [Screenshot maintenance](docs/screenshots/README.md).

Licensed under MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
