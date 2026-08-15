# Redcode

Redcode is RedDB's terminal coding agent.

It is built on [OpenCode](https://github.com/anomalyco/opencode), whose codebase gave us a complete,
well-made coding agent to start from, and it takes that foundation in a specific direction: a typed
Effect service kernel underneath, durable Session semantics that survive a crash, a runtime composed
of reversible plugin profiles, and native integration with RedSkills so an autonomous Worker fleet is
a first-class surface rather than a separate dashboard.

We did not set out to replace OpenCode — it remains an excellent agent, and if it fits your work you
should use it. Redcode exists because RedDB needed those particular runtime properties for the way we
run our own engineering, and building them on OpenCode was far better than starting over.

## Install

```bash
npm install -g @reddb-io/redcode
redcode
```

Bun, pnpm, and Yarn work too. The install resolves one native binary for your platform — Linux
(glibc and musl, x64 and arm64), macOS (x64 and arm64), and Windows (x64 and arm64), with
non-AVX2 variants where the architecture needs them.

Redcode ships exactly one artifact: the CLI. There is no beta channel, no container image, no
desktop build, no package-manager tap, and no hosted deployment. That posture is enforced by a
CI-blocking contract test (`script/test-redcode-release-contract.ts`) that fails if a deleted
upstream workflow reappears or if `sst deploy`, `docker buildx build`, or a stray `npm publish`
shows up outside the one release workflow.

### A note on names

The product is Redcode; most of the source still says OpenCode. Workspace packages are
`@opencode-ai/*`, the package that becomes the binary is literally named `opencode`, and environment
variables are `OPENCODE_*`. What *is* renamed is everything a user touches: the `redcode` binary,
the `redcode` XDG data and cache directories, the npm namespace, and the agent's identity over ACP.

Leaving the internals alone is deliberate. A rename would touch every file, bury the real changes in
noise, and make it harder to read our work against upstream's — so expect the mismatch and read
`opencode` as "this codebase".

## Use

Running `redcode` with no arguments opens the TUI directly in a new session.

| Command | What it does |
| --- | --- |
| `redcode` | Terminal UI — sessions, diffs, permissions, and the Workers fleet |
| `redcode run` | Non-interactive prompt; `--format json` emits structured records |
| `redcode serve` | HTTP server exposing the Protocol API |
| `redcode acp` | Agent Client Protocol, for editors that speak ACP |
| `redcode mcp` | Manage the MCP servers Redcode connects to (it is an MCP client, not a server) |
| `redcode attach` | Attach to a running server |
| `redcode web` | Start the server and open the local web interface |
| `redcode session` | Manage Sessions |
| `redcode agent` / `plugin` / `models` / `providers` | Configure what the agent is made of |
| `redcode export` / `import` | Move Session history in and out |
| `redcode github` / `pr` | Repository automation |
| `redcode stats` | Token usage and cost |
| `redcode db` / `debug` | Introspection — a sqlite shell over the durable store, and debug dumps for config, agents, skills, LSP, and the V2 catalog |

`redcode --help` lists everything, including `upgrade`, `uninstall`, `generate`, and `console`.

### Workers

When RedSkills is enabled for a project, the TUI's **Workers** tab is a live console for the Worker
fleet the `redskilled` daemon is running: host capacity meters, per-Worker phase progress and
heartbeat freshness, throughput derived across polls, and an activity feed per Worker. You can stop,
recycle, and steer a Worker without leaving the session, and switch between this project's Workers
and every Worker on the host.

The integration is consent-gated per project and reads through a local unix socket — nothing leaves
the machine to make it work.

## What Redcode changes

**An Effect kernel with Location scoping.** Services, resources, and their lifetimes are typed and
scoped. `SessionRunner`, model resolution, the tool registry, permissions, and the filesystem are
Location-scoped; `SessionExecution` is process-global and keyed by Session ID.

**Durable Sessions.** `SessionV2.prompt(...)` admits one durable input row before any model work is
scheduled, so a prompt is never lost to a crash between accepting it and acting on it. Retries
reconcile against the durable record instead of duplicating work. Each provider turn is exactly one
explicit `llm.stream(request)` call, and projected history is reloaded before durable continuation.

**Explicit delivery semantics.** Prompts *steer* by default — they land at the next safe provider-turn
boundary while the current drain continues. An explicit `queue` input waits until the Session would
otherwise go idle.

**A composed, reversible runtime**, modelled on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Internal plugins are one named profile mounted through a Cordis host: activation is ordered and
awaited, teardown is awaited, and a failed replacement restores the previous profile. Boot is not
"ready" until the profile settles and every registered runtime invariant has run. See
[ADR 0001](.red/adr/0001-hybrid-cordis-effect-plugin-runtime.md), which records what we adopted from
the Harness and, just as deliberately, what we chose not to.

**System Context as data.** What the model sees is assembled from typed Context Sources with stable
keys and pure renderers, cut by a persisted Context Epoch — not from a string template.

**A release contract.** Every user-visible change carries a changeset; the Version PR is the only
writer of versions; tags are immutable.

## Architecture

```
Schema ──► Core ──┐
   │              ├──► Server ──► sdk-next
   └──► Protocol ─┘
              │
              └──► Client (browser-safe)
```

Runtime dependencies run one way: Schema into Core and Protocol, then Core and Protocol into Server.
Client runtime code may depend on Schema and Protocol but **never** Core or Server, which is what
keeps the browser bundle honest. `sdk-next` composes Client, Core, and Server into an in-process
host. The TUI's only boundary to the rest of the system is the SDK — it does not import Core, and it
does not import the CLI that hosts it.

The packages that matter most:

| Package | Role |
| --- | --- |
| `packages/schema` | Semantic values shared by the internal domain and the public wire |
| `packages/core` | Sessions, tools, providers, permissions, plugins, System Context |
| `packages/protocol` | Paths, payloads, envelopes, errors, cursors, and streams |
| `packages/server` | Hosts Protocol's groups; owns protocol/domain adaptation |
| `packages/client` | Generated clients — Promise root, `/effect` variant |
| `packages/tui` | Terminal UI (OpenTUI + Solid) |
| `packages/opencode` | The CLI that becomes the `redcode` binary |
| `packages/plugin` | Public plugin API |
| `packages/sdk/js` | The SDK the TUI, CLI, and ACP agent all talk through |

Not the product, despite appearances: `packages/cli` is a parallel Effect-native CLI preview whose
binary is `lildax`, and `packages/desktop`, `packages/web`, `packages/console`, and `packages/stats`
are inherited from upstream and are not built or published here.

`packages/client/src/generated*` is generated. After changing the public Protocol or Server
`HttpApi`, run `bun run generate` from `packages/client` rather than editing it.

## Status

Redcode inherits OpenCode mid-rebuild, and the v2 runtime is where the work is. Shipped and load
bearing today: the Effect `HttpApi` server, durable `EventV2` with sequencing and replay, SessionV2
durable admission with steer/queue delivery, the Effect-native `SessionRunner`, the System Context
algebra and registry, Context Epoch persistence, and the Cordis plugin host.

Deliberately not done yet, so you do not have to find out the hard way:

- **Post-crash continuation recovery.** An advisory wake will not retry ambiguous provider work; that
  needs its own design first.
- **Clustering.** Session drains stay process-local.
- **Workspace placement.** Explicit workspace identity is reserved; workspaces sit behind
  `OPENCODE_EXPERIMENTAL_WORKSPACES`.
- **A stable client API.** Namespaces and the paginated `Page` shape are still settling.
- **Dynamic plugins, config HMR, YAML profiles.** Out of scope until the trust and transaction models
  exist ([ADR 0001](.red/adr/0001-hybrid-cordis-effect-plugin-runtime.md)).

`specs/v2/todo.md` is the working list.

## Development

Requires Bun 1.3+.

```bash
bun install
bun dev
```

Tests and typechecks run from the package that owns them, never from the repository root:

```bash
cd packages/core && bun test
cd packages/tui  && bun run typecheck
```

The default branch is `main`. Branch names are at most three hyphenated words with no type prefix
(`session-recovery`, not `feat/session-recovery`). Commits and PR titles are conventional:
`type(scope): summary`.

Every user-visible pull request adds a `.changeset/*.md` entry targeting `opencode`.

`AGENTS.md` carries the full style guide and the runtime rules that reviews enforce. `CONTEXT.md`
defines the Session Runtime vocabulary — read it before arguing about what a term means.

## Releases

1. A merged PR's changeset updates the generated Version PR.
2. Merging the Version PR writes versions and creates the immutable `vX.Y.Z` tag.
3. `red-publish` builds the native binaries, publishes `@reddb-io/redcode`, verifies a clean install
   from the registry, and publishes the GitHub Release.

Released tags are immutable — a broken release is fixed by publishing the next patch, never by
replacing a tag. An incomplete tag can be reconciled by dispatching `red-publish` with it.

## Lineage

Redcode stands on two projects we admire, and we would rather name exactly what we owe them than
thank them vaguely.

**[OpenCode](https://github.com/anomalyco/opencode)** is the codebase Redcode is built from. The
agent loop, the provider and model integration, the tool system, the LSP and formatter plumbing, the
terminal UI foundation — that is their work, not ours. Redcode is a fork under the MIT License with
its copyright and license notices preserved. We keep the divergence narrow on purpose: the internals
still carry OpenCode's names precisely so our changes stay legible against theirs. Redcode does not
speak for the OpenCode project; please report Redcode issues here so we do not send our bugs to
their tracker.

**[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)** is the architecture we
studied to get our runtime right. Its insistence that a running system be a reversible, inspectable
composition — every installed effect with one owner, activation ordered and awaited, invariants owned
by the package they protect, and tests that prove semantic outcomes through real entry points —
reshaped how Redcode boots. Their published post-mortems taught us more than most documentation
does. We also depend on `@deepseek-ai/cordis` (MIT), which they maintain inside that repository, as
the host for our plugin profiles. Three research reports in `.red/researches/` record the audit
honestly, including the principles we have not earned yet.

Neither project owes us anything, and any mistakes in how we applied their ideas are ours.
