<div align="center">

<img src="docs/hero.svg" alt="Redcode - RedDB's terminal coding agent, with a per-project secret vault, dual reasoning, goals, design mode, monitors and a live worker fleet console" width="100%" />

<p>
  <a href="https://www.npmjs.com/package/@reddb-io/redcode"><img src="https://img.shields.io/npm/v/%40reddb-io%2Fredcode?style=for-the-badge&label=npm&color=ff2056&labelColor=0d1117" alt="npm version"></a>
  <a href="https://github.com/reddb-io/redcode/actions/workflows/redcode.yml"><img src="https://img.shields.io/github/actions/workflow/status/reddb-io/redcode/redcode.yml?branch=main&style=for-the-badge&label=CI&labelColor=0d1117" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge&labelColor=0d1117" alt="License"></a>
  <a href="#use"><img src="https://img.shields.io/badge/TUI%20%7C%20server%20%7C%20ACP%20%7C%20MCP-ff2056?style=for-the-badge&label=runs%20as&labelColor=0d1117" alt="Surfaces"></a>
</p>

<strong>RedDB's terminal coding agent.</strong><br>
Secrets the model uses but never sees, a second mind that checks the first,
and an autonomous fleet on screen next to your session.

</div>

---

Redcode is reddb.io's coding agent for our own engineering work. It is built on
[OpenCode](https://github.com/anomalyco/opencode): its agent loop, providers, tools and terminal UI are the
foundation this stands on. Attribution is preserved in [NOTICE](NOTICE).

## What Redcode adds

| | Feature | In one line |
| --- | --- | --- |
| 🔐 | [Vault](#vault) | Per-project secrets the model can use, obtain and ask for without seeing the value |
| 🧠 | [S1 · S2 reasoning](#s1--s2-dual-reasoning) | A second model evaluates the first with typed questions |
| 🎯 | [/goal](#goal) | A definition of done pursued across turns, judged every turn |
| 🎨 | [Design mode](#design-mode) | Prototype in the browser, review it there, leave with a plan |
| 🧭 | [Modes](#modes) | Build, plan, design and question: four agents, one `Tab` apart |
| 🔀 | [RedRouter](#redrouter) | One key, many providers, with pinned offers and an auto variant |
| 👁 | [Monitors](#monitors) | Background watches the agent starts, in one tab |
| 🛠 | [Workers](#workers) | The RedSkills fleet as a tab in your session |
| 🛑 | [Stop-loss](#stop-loss-and-loop-guard) | Halts a stuck or runaway agent without punishing progress |
| 🗜 | [Compaction](#compaction) | Focused, anchored, background, and free of secrets |
| 🌿 | [Worktrees and service](#worktrees-and-the-background-service) | Isolated worktrees per task, and a server that outlives the TUI |
| 🎙 | [Dictation](#dictation) | Speak into the composer; you decide when it is sent |

## Install

```sh
npm install -g @reddb-io/redcode
redcode
```

With [mise](https://mise.jdx.dev), which installs the release binary straight from GitHub and needs no Node:

```sh
mise use -g github:reddb-io/redcode@latest
```

Native archives for Linux, macOS and Windows are also on the
[Redcode releases](https://github.com/reddb-io/redcode/releases) page. Each includes
`redcode` and `redcode-rpc-sidecar`; checksums are in `SHA256SUMS`. Keep one installation
method per machine.

## Use

| Command                     | Purpose                                         |
| --------------------------- | ----------------------------------------------- |
| `redcode`                   | Open the terminal UI                            |
| `redcode --yolo`            | Open with automatic permission approval         |
| `redcode --tmp`             | Work in a throwaway worktree                    |
| `redcode setup` or `/setup` | Configure and check S2 and optional S1          |
| `/intelligence`             | Inspect selected models and session evaluations |
| `/design`                   | Switch to Design mode                           |
| `/design-open`              | Resume a Design conversation                    |
| `/design-review`            | Open the current conversation's browser review  |
| `/goal`                     | Start, inspect or control a session goal        |
| `/vault`                    | Manage this project's secrets                   |
| `/monitors`                 | List the session's background monitors          |
| `/workers`                  | Inspect the RedSkills worker fleet              |
| `/worktrees`                | Manage the project's git worktrees              |
| `/budget`                   | Set an optional spend or token budget           |
| `redcode vault set\|import` | Store a secret, or import a `.env` file         |
| `redcode service`           | Control the background server                   |
| `redcode run`               | Run a prompt without the full TUI               |
| `redcode serve`             | Run the HTTP server                             |
| `redcode acp`               | Run the Agent Client Protocol integration       |
| `redcode --help`            | List CLI commands                               |

## Modes

A session runs one of four primary agents. `Tab` cycles through them (`Shift+Tab` goes back), and the
switch is durable: the next prompt is admitted under the agent you picked. Each mode is a different
answer to what the agent is allowed to touch.

<img src="docs/features/build.svg" alt="Build mode" width="100%" />

**Build** is the default. It reads, edits and runs under the permissions you configured, and it
delegates to subagents when the work fans out. The other modes are defined by what they take away from it.

<img src="docs/features/plan.svg" alt="Plan mode" width="100%" />

**Plan** reads everything and changes nothing but the plan file. Use it when the shape of the work is the
question: the agent explores, asks and writes the plan down, and `plan_exit` asks whether to switch to
build and start on it.

<img src="docs/features/design.svg" alt="Design mode" width="100%" />

**Design** is for when the question is what something should be, not how to build it. See
[Design mode](#design-mode).

<img src="docs/features/question.svg" alt="Question mode" width="100%" />

**Question** answers investigative questions about the codebase with read-only tool access. Nothing is edited.

## Vault

<img src="docs/features/vault.svg" alt="Vault" width="100%" />

Agents need credentials to do real work: call an API, log in and fetch a token, push to a registry. They
should not need to read them. The vault keeps secrets **per project** and lets the model work with a
reference such as `{vault:github-token}` instead of the value.

- **Pasting a secret is safe.** A high-confidence secret in your prompt is moved into the vault before
  anything is stored, and the transcript, the event log and the model only ever see the reference.
- **The model can use a secret.** References in shell commands and env-style file writes are resolved by
  the harness at the last step, in a way that survives shell quoting. Tool output is scrubbed of every
  known value on the way back.
- **The model can obtain one.** A token that a tool prints, such as a login response, is captured into the
  vault automatically, so the next call can use it without the value ever entering the context.
- **The model can ask for one.** `vault_request` opens a masked input for you. The model gets a reference back.
- **Hosts are bound.** The first time a secret is used against a host, you are asked once; after that
  the secret only goes where you approved.
- **The model is told how.** The harness explains the vault to the model in its instructions, and lists the
  names it may use, never the values.
- **Restricted content is flagged.** S1 marks messages that carry restricted content, protects them, and tells
  you the secrets were removed from the context. `/compact` and session titles pass through the same redaction.

Secrets belong to the project (worktrees of one repository share it) and never fall back to a global
scope. Manage them with `/vault`, `redcode vault set NAME` (masked prompt, or a piped value), or
`redcode vault import .env`. Vault coverage is measured in CI against a 90% line target.

## S1 · S2 dual reasoning

<img src="docs/features/intelligence.svg" alt="S1 and S2 dual reasoning" width="100%" />

**S2** generates responses and does the agent work. **S1** evaluates candidates with typed
TypeSafe/JEV questions, so a claim is checked before you trust it. **Single** reasoning uses S2 alone;
**dual** adds S1. Run `/setup` (or `redcode setup`) to pick and check the models, and `/intelligence`
to inspect the current models, the effective mode and recent evaluations. An unavailable, inconclusive
or rejected evaluation is shown as such, never as an approval. See [reasoning roles](docs/system-one.md).

## Goal

<img src="docs/features/goal.svg" alt="Goal" width="100%" />

Every mode is turn by turn: the agent answers, the harness waits for you. `/goal` changes that for one
session. You give it a definition of done, and the harness keeps the agent on it across turns until it
holds, until it is blocked, or until the budget runs out.

```
/goal make the design suite pass; verify: bun test test/design; gate: bun test test/design;
constraints: do not touch the app package; stop when: a test needs a network
```

Free text is the objective. The optional fields, one per line or separated by `;`, are the contract the
judge holds the agent to:

| Field | What it fixes |
| --- | --- |
| `outcome:` / `done when:` | What has to be true at the end |
| `verify:` | How the agent should prove it |
| `gate:` | A shell command that must exit 0 before the goal can be judged done; several allowed |
| `constraints:` / `scope:` | What may not be touched or changed |
| `stop when:` | What should make the agent stop and ask instead of pushing on |

At the end of every turn the gates run, and a failing gate feeds its output into the next turn. Then a
small judge reads the objective and the last answer and says **DONE**, **CONTINUE**, **BLOCKED** or
**WAIT**. The objective lives in session metadata, not the transcript, so compaction cannot paraphrase it
away. The agent may claim completion with `goal_complete`, but the next judgement consumes that claim
rather than trusting it. `Ctrl+C` pauses a goal, and so does a new process: a loop never restarts itself.
`/goal-pause`, `/goal-resume` and `/goal-drop` do what they say.

## Design mode

Design mode is for working out what something should be by building it. The agent writes an interactive
prototype, you review it in your browser, and what you decide becomes a plan. The agent cannot edit the
product in this mode, only the prototype, so nothing you say changes code until you leave.

- **Targets.** Prototype for the `web`, for an `app`, or as `presentation` slides.
- **Review in the browser.** Click an element, select text or a diagram node and leave a note. Nothing
  reaches the agent until you press **Send to Agent**. The page reloads when the agent saves and keeps
  your place.
- **Layout audit.** After every load the browser looks for cut-off text, controls outside the viewport and
  sideways scrolling. You choose which findings to queue as fixes.
- **Whiteboard.** Mermaid diagrams open in an Excalidraw whiteboard; your edits go back as a note and a PNG.
- **Your design system.** The agent reads `DESIGN.md` (or `.red/DESIGN.md`) and reuses the project's real
  components. Set `design.system` in `redcode.json` to point at it.
- **Finish.** `design_exit` writes the plan from the decisions and open questions recorded in `design.json`.

Prototypes live in `.redcode/designs/<name>/`. `redcode serve --hostname 0.0.0.0` lets you review from a phone.

## RedRouter

<img src="docs/features/router.svg" alt="RedRouter" width="100%" />

RedRouter is a provider that fronts many models behind one key. Redcode understands it natively: an
`auto` variant lets the router choose, pinned offers fix a model to a specific provider, model
suggestions surface what your key can reach, and the router's MCP tools are registered for you.

## Monitors

<img src="docs/features/monitors.svg" alt="Monitors" width="100%" />

When the agent starts something that should keep running, such as a dev server, a build or a poll, it
starts a monitor instead of sleeping in a loop. `/monitors` lists them in one tab with their state, and the
session is woken when one finishes or expires.

## Workers

<img src="docs/features/workers.svg" alt="Workers" width="100%" />

Redcode integrates natively with [RedSkills](https://github.com/reddb-io/red-skills) and its host-scoped
`redskilled` daemon. The **Workers** view is a live, project-scoped console: each worker's identity,
process and time, an activity feed of arrivals and departures, and project controls such as drain, stop
and status. Redcode keeps no separate control state; the daemon owns it.

## Stop-loss and loop guard

<img src="docs/features/stop-loss.svg" alt="Stop-loss" width="100%" />

Two safety nets watch every session. The **loop guard** notices an agent repeating the same call with the
same result. The **stop-loss** notices a session that keeps spending without making progress. Both were
calibrated to ignore normal work: an edit acknowledgement is not a repeat, and cached context is not spend
growth. There are no default cost limits. `/budget` sets a limit only when you ask for one, and a
model can never set its own.

## Compaction

<img src="docs/features/compaction.svg" alt="Compaction" width="100%" />

`/compact` can take a focus (`/compact keep the migration steps`), runs in the background, and keeps
anchors: the user messages and decisions that must survive verbatim. Its output passes through the same
redaction as the vault, so a secret pasted earlier in the chat does not come back in the summary.
`/restricted` lists the messages marked as restricted content and lets you remove one from the context.

## Worktrees and the background service

<img src="docs/features/worktrees.svg" alt="Worktrees" width="100%" />

`redcode --tmp` starts in a throwaway git worktree, and `/worktrees` (or `redcode worktrees`) lists,
creates, refreshes and cleans the project's worktrees. The server that holds your sessions can run in the
background, so closing the terminal does not stop them: `redcode service status|start|stop|restart`. If
it fails to start, the message says why.

## Dictation

<img src="docs/features/voice.svg" alt="Dictation" width="100%" />

The composer accepts structured dictation from [dit](https://github.com/reddb-io/dit) over a local,
process-scoped socket. Partial text is replaceable, committed segments accumulate, and finishing leaves an
editable draft. Voice input never submits the composer. See [voice input](docs/voice-input.md).

## Development

Current implementation lives in `packages/core`, `packages/cli`, `packages/tui`, `packages/server`,
`packages/protocol` and `packages/schema`. `packages/redcode` packages the CLI as Redcode. Internal
`@opencode/*` package names preserve the upstream architecture and do not change the published product name.

`main` is the development branch. Run `bun run check` for lint and type checking. Tests run from package
directories, never the repository root. Regenerate the client with `bun run generate` in
`packages/client` after changing the public API. The README artwork is generated:
`bun script/readme/banners.ts` rewrites `docs/hero.svg` and `docs/features/*.svg`.

## Releases

Publish through the [redcode workflow](https://github.com/reddb-io/redcode/actions/workflows/redcode.yml):

```sh
gh workflow run redcode.yml --repo reddb-io/redcode --ref main -f publish=true
```

The workflow runs checks and tests, builds native CLI/sidecar and Design archives, publishes npm
packages, verifies installation and checksums, then publishes the GitHub releases. Changesets record
release intent for `@reddb-io/redcode`; the workflow versions and publishes directly from `main`.
See [CI/CD](docs/ci-cd.md).

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
