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
| `/workers` | Inspect the local **RedSkills** fleet. For remote Redcode tasks, use the [distributed workers guide](distributed-workers.md). |

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
