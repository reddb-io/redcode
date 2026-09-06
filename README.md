<div align="center">

<img src="docs/hero.svg" alt="Redcode - RedDB's terminal coding agent, with durable Sessions, a reversible runtime, and a live Worker fleet console" width="100%" />

<p>
  <a href="https://www.npmjs.com/package/@reddb-io/redcode"><img src="https://img.shields.io/npm/v/%40reddb-io%2Fredcode?style=for-the-badge&label=npm&color=ff2056&labelColor=0d1117" alt="npm version"></a>
  <a href="https://github.com/reddb-io/redcode/actions/workflows/red-workspace-ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/reddb-io/redcode/red-workspace-ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=0d1117" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge&labelColor=0d1117" alt="License"></a>
  <a href="#use"><img src="https://img.shields.io/badge/TUI%20%7C%20server%20%7C%20ACP%20%7C%20MCP-ff2056?style=for-the-badge&label=runs%20as&labelColor=0d1117" alt="Surfaces"></a>
</p>

<strong>RedDB's terminal coding agent.</strong><br>
Prompts are durable before they run, the runtime can be taken apart and put back
together, and the autonomous Worker fleet is on screen next to your session.

</div>

---

Redcode is reddb.io's coding agent for our own engineering work. It is built on
[OpenCode](https://github.com/anomalyco/opencode) — their agent loop, providers, tools, and terminal
UI are the foundation this stands on — and its runtime composition is modelled on
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Both are projects we learned a
great deal from, and neither owes us anything.

Attribution is preserved in [NOTICE](./NOTICE).

One property shapes everything else: **a prompt becomes durable before anything tries to execute
it**. Read [The Session Model](#the-session-model) first — the rest of this document assumes it.

## Contents

**Start here**

- [What Ships And What Doesn't](#what-ships-and-what-doesnt) — the one distinction that makes this repo readable
- [The Session Model](#the-session-model) — durable admission, delivery, and provider turns

**Core**

- [The Runtime](#the-runtime) — the Effect kernel and reversible plugin profiles
- [Workers](#workers) — the RedSkills fleet console
- [Architecture](#architecture) — dependency direction and the packages that carry weight

**Installing and using it**

- [Install](#install) — one binary, nothing else
- [Use](#use) — every command, and what it is for
- [Modes](#modes) — build, plan and design: three agents, one `Tab` apart
- [Design Mode](#design-mode) — prototype in the browser, review it there, come out with a plan
- [Goal](#goal) — a definition of done the harness pursues across turns

**Reference**

- [A Note On Names](#a-note-on-names) — why the source says OpenCode
- [Status](#status) — what is shipped and what is deliberately not
- [Development](#development) — building and testing Redcode itself
- [Releases](#releases) — changesets, the Version PR, and immutable tags
- [Lineage](#lineage) — what we owe OpenCode, DeepSeek, and Cordis
- [License](#license)

## What Ships And What Doesn't

This repository contains far more than the product, because it inherits a monorepo built for a
larger surface than Redcode targets. Telling the two apart is the fastest way to read it.

**Ships — this is Redcode.**

| Piece | What it is | Where |
| --- | --- | --- |
| `@reddb-io/redcode` | The native `redcode` CLI and its `redcode-rpc-sidecar` companion. | [Install](#install) |
| The TUI | Sessions, diffs, permissions, and the Worker fleet | [Use](#use) |
| The server, ACP agent, MCP client | The same binary, other entry points | [Use](#use) |

**Does not ship — present, useful in development, never published.**

| Piece | What it is |
| --- | --- |
| `packages/cli` | A parallel Effect-native CLI preview whose binary is `lildax`. Not the product. |
| `packages/desktop`, `packages/web` | Electron and Astro surfaces inherited from upstream |
| `packages/console`, `packages/stats` | Hosted opencode.ai services, not ours to run |
| `packages/storybook`, `packages/enterprise`, `packages/slack` | Upstream workspaces we do not build |

That boundary is not a convention — it is a **ratchet**. `script/test-redcode-release-contract.ts`
runs in CI and fails the build if any of 22 deleted upstream workflows reappear, if `sst deploy`,
`docker buildx build`, or a stray `npm publish` shows up outside the single release workflow, or if
`red-publish.yml` starts mentioning `beta`, `docker`, `desktop`, `sst`, or `vscode`.

## The Session Model

Most agents accept your prompt into memory and start working. If the process dies in between, the
prompt is gone and you find out by noticing that nothing happened.

Redcode splits those two steps. **`SessionV2.prompt(...)` writes one durable input row and returns**;
only then does it schedule an advisory wake for the executor. Admission and execution are separate
concerns with separate failure modes, which is what makes the rest of the model possible.

| Step | What is guaranteed |
| --- | --- |
| **Admission** | The prompt is durable. Reusing a prompt ID reconciles an exact retry instead of duplicating work; conflicting reuse fails loudly. |
| **Promotion** | An admitted prompt becomes a visible user message only at a safe provider-turn boundary — after durable input promotion and any required tool settlement. |
| **Provider turn** | Exactly one explicit `llm.stream(request)` call. Projected history is reloaded before durable continuation rather than carried in memory across the boundary. |
| **Result** | One normalized durable result per admitted tool call, in the model's own result order even when tools ran concurrently. |

Delivery is explicit vocabulary, not a heuristic:

- **Steer** (the default) — the input lands at the next safe boundary while the current drain keeps
  going. A batch of steers resets the agent's provider-turn allowance once.
- **Queue** — the input stays pending until the Session would otherwise go idle, then exactly one
  queued input is promoted before continuation is reevaluated.

What the model sees is assembled the same way: **System Context** is a set of typed Context Sources
with stable keys, JSON codecs, and pure renderers, cut by a persisted **Context Epoch** — not a
string template someone concatenated. When a source changes mid-conversation, the model is told the
newly effective state chronologically instead of having its history rewritten underneath it.

`CONTEXT.md` is the full vocabulary. It is worth reading before arguing about what a term means.

## The Runtime

Services, resources, and lifetimes are typed with [Effect](https://effect.website) and scoped by
**Location** — a directory plus its project, and eventually a workspace. `SessionRunner`, model
resolution, the tool registry, permissions, and the filesystem are Location-scoped;
`SessionExecution` is process-global and keyed by Session ID, so no layer ever takes a Session ID
just to work out where execution belongs.

On top of that sits the part we adapted from DeepSeek Harness. Internal plugins are not an
imperative sequence of `add` calls — they are **one named profile mounted through a Cordis host**:

- activation is **ordered and awaited**, so "ready" means the composition actually settled;
- teardown is awaited, so removing a plugin means its effects are gone, not scheduled to go;
- replacement is **transactional** — a failed candidate restores the previous profile;
- boot is not ready until every **runtime invariant** registered by its owning package has run.

The boundary is deliberate and documented in
[ADR 0001](./.red/adr/0001-hybrid-cordis-effect-plugin-runtime.md): Cordis owns *only* the outer
composition fibers, Effect keeps owning services and cleanup, and Cordis never becomes a second
service locator. Dynamic model-authored plugins, config HMR, and YAML profile loading are explicitly
**not** enabled — the Harness supports executable configuration expressions, and we chose not to
take that.

The audit behind those choices, including the principles we have not earned yet, is in
`.red/researches/`.

## Workers

Redcode integrates natively with [RedSkills](https://github.com/reddb-io/red-skills) and its
host-scoped `redskilled` daemon, so the autonomous fleet is a tab in your session rather than a
separate dashboard.

The **Workers** view is a live, project-scoped console over the daemon's public ACP session:

- **Per Worker** — identity, process, start time, elapsed time, and declared memory budget from the
  public Project projection. Rich phase, heartbeat, log, and host-capacity details remain blank
  because the public ACP snapshot does not expose them.
- **History** — arrivals and departures observed through successive ACP snapshots remain visible in
  the local activity feed.
- **Control** — Project drain, stop, and status use redskilled's advertised typed methods. Resize and
  Worker stop, recycle, and steer run as generic ACP Project turns (`/project_resize`, `/worker_stop`,
  `/worker_recycle`, and `/runner_steer`); `enter` expands one Worker to full width and `o` opens its
  issue. Redcode does not poll `steer_status`, because ACP core exposes no typed result for that read.

Redcode stores no separate consent, registration, or Project-control state. Drain intent and policy
remain daemon-owned, and status comes from the Project projection reached through the supported
`red-skills-redskilled acp` stdio adapter. Host-wide details are not presented because the public ACP
session deliberately binds each connection to one Project.

## Install

```bash
npm install -g @reddb-io/redcode
redcode
```

Bun, pnpm, and Yarn work too. The install resolves one native package for your platform — Linux
(glibc and musl, x64 and arm64), macOS (x64 and arm64), and Windows (x64 and arm64), with non-AVX2
variants where the architecture needs them. Each package contains `redcode` and the matching
`redcode-rpc-sidecar` companion.

### With mise

mise installs the release binary straight from GitHub, no Node required. This is what
[red-dev](https://github.com/reddb-io/red-dev) sets up, so a machine provisioned by it already has
Redcode this way.

```bash
mise use -g github:reddb-io/redcode@latest
redcode
```

Upgrade the same install with:

```bash
mise upgrade github:reddb-io/redcode
```

Two notes worth knowing:

- Pin `@latest` rather than an exact version. `mise upgrade` keeps whatever range the tool was
  installed with, so an exact pin never moves on its own.
- If an upgrade reports success but `redcode --version` does not change, mise served a cached
  version list. Run `mise cache clear github:reddb-io/redcode` and upgrade again.

Keep one installation method per machine. An npm global and a mise install can both provide
`redcode`, and then `$PATH` order decides which one runs — updating the one you are not running
looks like an update that did nothing. `which redcode` tells you which copy is live.

There is no beta channel, no container image, no desktop build, no package-manager tap, and no
hosted deployment. See [What Ships And What Doesn't](#what-ships-and-what-doesnt) for why that is
enforced rather than merely intended.

## Use

Running `redcode` with no arguments opens the TUI directly in a new session.

| Command | What it does |
| --- | --- |
| `redcode` | Terminal UI — sessions, diffs, permissions, and the Workers fleet |
| `redcode run` | Non-interactive prompt; `--format json` emits structured records |
| `redcode serve` | Headless HTTP server exposing the Protocol API |
| `redcode acp` | Agent Client Protocol over stdio; `--experimental-toon` selects TOON-RPC framing |
| `redcode mcp` | Manage the MCP servers Redcode connects to — it is an MCP client, not a server |
| `redcode attach` | Attach to a running server |
| `redcode web` | Start the server and open the local web interface |
| `redcode session` | Manage Sessions |
| `redcode agent` / `plugin` / `models` / `providers` | Configure what the agent is made of |
| `redcode export` / `import` | Move Session history in and out |
| `redcode github` / `pr` | Repository automation |
| `redcode stats` | Token usage and cost |
| `redcode db` / `debug` | A sqlite shell over the durable store, and dumps for config, agents, skills, LSP, and the V2 catalog |

`redcode --help` lists everything, including `upgrade`, `uninstall`, `generate`, and `console`.

In the TUI, the line under the prompt shows the context used, the cost so far, the latency to the
first token of the last answer, and the tokens per second it arrived at.

`redcode serve` prints both its base URL and the exact `POST /rpc` endpoint. That endpoint accepts
JSON-RPC 2.0 (`application/json`) and TOON-RPC 1.0 (`application/toon`) for the same typed read-only
methods: `health.get`, `session.list`, and `session.active`. `session.list` accepts the same filters,
ordering, limit, and cursor semantics as `GET /api/session`.

The sibling `redcode-rpc-sidecar` bridges bounded `Content-Length` frames on stdin/stdout to that
HTTP endpoint. Set `REDCODE_RPC_URL` to the printed URL. It reuses
`OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`, or accepts a complete
`REDCODE_AUTHORIZATION` header.

## Modes

A session runs one of three primary agents. `Tab` cycles through them (`Shift+Tab` goes back), in
the TUI and in the web UI, and the switch is durable: the next prompt is admitted under the agent
you picked. Each mode is a different answer to what the agent is allowed to touch.

<img src="docs/modes/build.svg" alt="Build mode" width="100%" />

**Build** is the default. It reads, edits and runs under the permissions you configured, and it
delegates: every subtask of one message runs together (four at a time by default), and background
subagents are on, capped per session so a fan-out cannot run away. A subagent started under a goal
inherits it. Nothing here is special — it is what a coding agent is — and the two other modes are
defined by what they take away from it.

<img src="docs/modes/plan.svg" alt="Plan mode" width="100%" />

**Plan** reads everything and changes nothing but the plan file, written under `.redcode/plans/`.
Use it when the shape of the work is the question: the agent explores, asks, and writes the plan
down; `plan_exit` asks whether to switch to build and start on it. A plan written here is what
build reads first.

<img src="docs/modes/design.svg" alt="Design mode" width="100%" />

**Design** is for when the question is what something should be, not how to build it. The agent
writes an interactive prototype instead of a description, you review it in your browser, and the
review is the conversation. Design cannot edit the product at all, only the prototype directory,
so nothing you decide reaches the code until `design_exit` writes the plan. The whole loop is in
[Design Mode](#design-mode).

## Design Mode

Design mode is for working out what something should be by building it. The agent writes an
interactive prototype, you review it in your browser — clicking, annotating, drawing on diagrams —
and what you decide becomes a plan. The agent cannot edit the product in this mode, only the
prototype, so nothing you say here changes code until you leave.

### Start

1. In the TUI, press `Tab` until the agent reads `design` (`Shift+Tab` goes back). In the web UI
   (`redcode web`), pick the `design` agent the same way. Describe what you want built.
2. The agent writes the prototype into `.redcode/designs/<timestamp>-<slug>/` — `index.html` plus
   whatever sits beside it — and calls `design_preview`. Your browser opens on the review page;
   its URL is also in the tool's output, and the web UI shows the same page in a **Design** tab.

The prototype runs with no network. A CDN link will not load, so the agent uses what the project
already has (it reads `DESIGN.md` or `.red/DESIGN.md` for the project's design system) or the
Tailwind, DaisyUI and Mermaid that ship with Redcode.

### Review

Everything on the review page is a proposal until you press **Send to Agent**; the agent's next
turn starts only then.

- **Annotate** is the default mode. Click an element, select some text, click a table cell or a
  node of a diagram, and a card opens. `Enter` queues the note, `Cmd/Ctrl+Enter` queues and sends,
  `Shift+Enter` is a line break, `Esc` closes an empty card. Paste or drop an image onto the card
  to attach a reference. `Cmd/Ctrl+I` switches to **Explore**, where the prototype behaves like a
  page; `Alt+click` still annotates there.
- **The conversation panel** on the right holds the queue (each note is a pill you can remove),
  the agent's replies, and a composer. **Hold** keeps what you typed in the queue without sending;
  **Send & End** sends and closes the review. Below 860px the panel is a sheet you pull up.
- **Live reload.** When the agent saves, the page reloads and keeps your place: scroll position,
  unsent notes, the text of an open card, and answers inside `data-redcode-question` groups.
- **Layout issues.** After every load the browser audits the layout — text cut off by its
  container, controls outside the viewport, a page that scrolls sideways, text covered by another
  element — and lists what it found under the **Layout issues** button. Nothing there reaches
  the agent on its own. Select the ones you want fixed and press **Queue selected fixes**; they
  become one note. **Dismiss** hides a warning for the current revision only; it comes back if a
  later revision still has it. A warning is cleared only when a newer revision no longer shows it.
- **Whiteboard.** A Mermaid diagram gets an Excalidraw whiteboard beside it. Click it to edit,
  drag nodes, redraw arrows, add shapes or freehand marks; **Fullscreen** opens it over the page.
  **Queue feedback** turns your edits into a note with a summary of what moved and a PNG for the
  agent, which then edits the Mermaid source — the whiteboard is how you talk about a diagram,
  never a second copy of it. The first whiteboard on a machine downloads the editor bundle
  (about 3MB) from the release; until then diagrams are plain.
- **The `⋮` menu**: copy the prototype's directory, reload it, copy a DOM snapshot, **Export
  standalone HTML** (one file with everything local inlined, which opens from disk), **Open on
  another device** (when the server listens beyond loopback), and **End review**.

### Finish

End the review from the `⋮` menu or with **Send & End**; the agent stops waiting for notes. When
the design is settled, the agent calls `design_exit`, which writes the plan from what it recorded
in `design.json` — the decisions, the open questions, a link to the prototype — and offers to
switch to the plan agent to refine it. The agent may also call `design_export` when you ask for a
file to share.

### Files

| Path | What it is |
| --- | --- |
| `.redcode/designs/<name>/index.html` | The prototype, with its assets beside it |
| `.redcode/designs/<name>/design.json` | `kind` (`screen`, `flow`, `comparison`, `deck`), `decisions`, `questions` — the reasoning the plan is written from |
| `.redcode/designs/<name>/.review/` | Review state, whiteboard scenes and exports; never served, not part of the design |
| `DESIGN.md` or `.red/DESIGN.md` | The project's design system as the agent understands it; edit it to correct the agent |

### Settings

Everything is on by default. Under `experimental.design` in the config: `attachments` (per-image,
per-note and disk caps for pasted images), `viewports` (which of `mobile`, `compact`, `desktop` the
layout audit reports on), `gate` and `gate_timeout` (the short curtain before a prototype is
shown), `export` (size caps for the standalone file), and `hosts` (extra names the review surface
answers to). `REDCODE_DESIGN_NO_OPEN=1` stops the browser from opening;
`REDCODE_DISABLE_WHITEBOARD_DOWNLOAD=1` never fetches the whiteboard bundle, and
`REDCODE_WHITEBOARD_DIR` points at a local build of it. To review from a phone, run
`redcode serve --hostname 0.0.0.0` and use the network URL `design_preview` prints.

## Goal

<img src="docs/modes/goal.svg" alt="Goal" width="100%" />

Every mode is turn by turn: the agent answers, the harness waits for you. `/goal` changes that for
one session. You give it a definition of done, and the harness keeps the agent on it across turns
until it holds, until it is blocked, or until the budget runs out.

```
/goal make the design suite pass; verify: bun test test/design; gate: bun test test/design;
constraints: do not touch the app package; stop when: a test needs a network
```

Free text is the objective. The optional fields — one per line or separated by `;` — are the
contract the judge holds the agent to:

| Field | What it fixes |
| --- | --- |
| `outcome:` / `done when:` | What has to be true at the end |
| `verify:` | How the agent should prove it |
| `gate:` | A shell command that must exit 0 before the goal can even be judged done; several allowed |
| `constraints:` / `scope:` | What may not be touched or changed |
| `stop when:` | What should make the agent stop and ask instead of pushing on |

Then, at the end of every turn:

- The gates run. A failing gate feeds its output into the next turn; the judge is not asked.
- A small judge reads the objective and the last answer and says **DONE**, **CONTINUE**,
  **BLOCKED** or **WAIT**. CONTINUE starts the next turn with the objective re-rendered in full —
  it lives in the session's metadata, not the transcript, so compaction cannot paraphrase it away
  and the model cannot quietly shrink it. BLOCKED parks the loop with the reason. WAIT means
  background subagents are still working and does not spend a turn.
- The agent may claim completion itself with `goal_complete` and its evidence; the next judgement
  consumes that claim rather than trusting it.

The budget is 20 turns by default, and running out of turns is not completion — the goal pauses and
says so. `Ctrl+C` pauses it; so does a new process, because a loop must never restart itself.
`/goal-pause`, `/goal-resume` and `/goal-drop` do what they say, and the goal's line under the
session shows where it stands. When the judge cannot answer, the loop fails open: three unreadable
verdicts in a row pause it rather than spin.

Defaults live under `experimental.goal` in the config: `max_turns`, `judge_timeout` and
`gate_timeout`.

## Architecture

```
Schema ──► Core ──┐
   │              ├──► Server ──► sdk-next
   └──► Protocol ─┘
              │
              └──► Client (browser-safe)
```

Runtime dependencies run one way: Schema into Core and Protocol, then Core and Protocol into Server.
Client runtime code may depend on Schema and Protocol but **never** Core or Server — that rule is
what keeps the browser bundle from transitively loading databases, Drizzle, Session execution,
providers, watchers, or native modules. `sdk-next` composes Client, Core, and Server into an
in-process host. The TUI's only boundary to the system is the SDK: it does not import Core, and it
does not import the CLI that hosts it.

| Package | Role |
| --- | --- |
| `packages/schema` | Semantic values shared by the internal domain and the public wire |
| `packages/core` | Sessions, tools, providers, permissions, plugins, System Context |
| `packages/protocol` | Paths, payloads, envelopes, errors, cursors, and streams |
| `packages/server` | Hosts Protocol's groups; owns protocol/domain adaptation |
| `packages/client` | Generated clients — zero-Effect root, `/effect` variant |
| `packages/tui` | Terminal UI (OpenTUI + Solid) |
| `packages/redcode` | The CLI that becomes the `redcode` binary |
| `packages/rpc-sidecar` | Static native companion that bridges framed JSON/TOON RPC to `/rpc` |
| `packages/plugin` | Public plugin API |
| `packages/sdk/js` | The SDK the TUI, CLI, and ACP agent all talk through |

`packages/client/src/generated*` is generated. After changing the public Protocol or Server
`HttpApi`, run `bun run generate` from `packages/client` rather than editing it by hand.

## A Note On Names

The product is Redcode; most of the source still says OpenCode. Workspace packages are
`@reddb-io/redcode-*`, the package that becomes the binary is literally named `opencode`, and environment
variables are `OPENCODE_*`. What *is* renamed is everything a user touches: the `redcode` binary, the
`~/.red/redcode/` data, cache, state, and config directories (the `~/.config/redcode/` XDG directory
is no longer read), the npm namespace, and the agent's identity
over ACP. The global config file is `~/.red/redcode/config.jsonc` (or `config.json`); the transitional
`redcode.json` / `redcode.jsonc` and the legacy `opencode.json` / `opencode.jsonc` names are still read
everywhere the primary `config.*` name is, and the primary file always wins on merge.

Leaving the internals alone is deliberate. A rename would touch every file, bury the real changes in
noise, and make our work harder to read against upstream's — so expect the mismatch and read
`opencode` as "this codebase".

## Status

Redcode inherits OpenCode mid-rebuild, and the v2 runtime is where the work is. Shipped and load
bearing today: the Effect `HttpApi` server, durable `EventV2` with transactional sequencing and
replay, SessionV2 durable admission with steer and queue delivery, the Effect-native `SessionRunner`,
the System Context algebra and registry, Context Epoch persistence, and the Cordis plugin host.

Deliberately not done yet, so you do not have to find out the hard way:

| Not yet | Why |
| --- | --- |
| Post-crash continuation recovery | An advisory wake must not retry ambiguous provider work; that needs its own design |
| Clustering | Session drains stay process-local until it exists |
| Workspace placement | Explicit workspace identity is reserved; workspaces sit behind `OPENCODE_EXPERIMENTAL_WORKSPACES` |
| A stable client API | Namespaces and the paginated `Page` shape are still settling |
| Dynamic plugins, config HMR, YAML profiles | Out of scope until the trust and transaction models exist ([ADR 0001](./.red/adr/0001-hybrid-cordis-effect-plugin-runtime.md)) |
| A runtime inspection surface | The composition is inspectable in code but has no CLI or API surface yet |

`specs/v2/todo.md` is the working list.

## Development

Requires Bun 1.3+.

```bash
bun install
bun dev
```

Tests and typechecks run from the package that owns them, never from the repository root — the root
`test` script exits 1 on purpose:

```bash
cd packages/core && bun test
cd packages/tui  && bun run typecheck
```

The default branch is `main`. Branch names are at most three hyphenated words with no type prefix
(`session-recovery`, not `feat/session-recovery`). Commits and PR titles are conventional:
`type(scope): summary`. Every user-visible pull request adds a `.changeset/*.md` entry targeting
`@reddb-io/redcode`.

`AGENTS.md` carries the full style guide and the runtime rules that reviews enforce.

## Releases

1. A merged PR's changeset updates the generated Version PR.
2. Merging the Version PR writes versions and creates the immutable `vX.Y.Z` tag.
3. `red-publish` builds the native binaries, publishes `@reddb-io/redcode`, verifies a clean install
   from the registry, then un-drafts the GitHub Release.

Released tags are immutable — a broken release is fixed by publishing the next patch, never by
replacing a tag. An incomplete tag can be reconciled by dispatching `red-publish` with it.

## Lineage

Redcode stands on other people's work, and we would rather name exactly what we owe than thank
anyone vaguely.

**[OpenCode](https://github.com/anomalyco/opencode)** is the codebase Redcode is built from. The
agent loop, the provider and model integration, the tool system, the LSP and formatter plumbing, and
the terminal UI foundation are theirs. Redcode is a fork under the MIT License with the upstream
copyright preserved. We keep the divergence narrow on purpose — the internals still carry OpenCode's
names precisely so our changes stay legible against theirs. Redcode does not speak for the OpenCode
project; please report Redcode issues here rather than on their tracker.

**[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** is the architecture we
studied to get our runtime right. Its insistence that a running system be a reversible, inspectable
composition — every installed effect with exactly one owner, activation ordered and awaited,
invariants owned by the package they protect, and tests that prove semantic outcomes through real
entry points — reshaped how Redcode boots. Their published post-mortems taught us more than most
documentation manages to. We adopted the principles rather than the product topology, and
[ADR 0001](./.red/adr/0001-hybrid-cordis-effect-plugin-runtime.md) records what we deliberately left
behind.

**[Cordis](https://github.com/cordiverse/cordis)**, by Shigma, is the plugin framework underneath
that composition. We depend on `@deepseek-ai/cordis`, the build DeepSeek vendors and maintains inside
the Harness repository, but the framework and its copyright are Shigma's.

Any mistakes in how we applied their ideas are ours.

## License

MIT. See [LICENSE](./LICENSE). See [NOTICE](./NOTICE) for upstream attribution and bundled runtime
notices.
