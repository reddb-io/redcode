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

- [Install](#install) — native CLI and installation methods
- [Use](#use) — every command, and what it is for
- [Modes](#modes) — Build, Plan and Design, with explicit handoffs
- [Design Mode](#design-mode) — prototype in the browser, review it there, come out with a plan
- [Tasks](#tasks) — requested work, progress and explicit blockers
- [Monitors](#monitors) — wait for commands and external jobs without blocking the chat
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
| `redcode design` | Interactive SessionV2 terminal with Design, Plan, Build and browser review |
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

In the TUI, the line under the prompt shows context use and cost. The Context sidebar shows
latency to the first token of the last answer and its token throughput.

`redcode serve` prints both its base URL and the exact `POST /rpc` endpoint. That endpoint accepts
JSON-RPC 2.0 (`application/json`) and TOON-RPC 1.0 (`application/toon`) for the same typed read-only
methods: `health.get`, `session.list`, and `session.active`. `session.list` accepts the same filters,
ordering, limit, and cursor semantics as `GET /api/session`.

The sibling `redcode-rpc-sidecar` bridges bounded `Content-Length` frames on stdin/stdout to that
HTTP endpoint. Set `REDCODE_RPC_URL` to the printed URL. It reuses
`OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD`, or accepts a complete
`REDCODE_AUTHORIZATION` header.

### Reloading MCP servers

Open `/mcps` while keeping your conversation open:

- Select a server and press **Enter** or **Ctrl+R** to reload it.
- Choose **Reload all MCPs** to reread configuration and reload all servers, including newly added entries.
- **Space** still enables or disables the selected server. Reload preserves these manual choices.

Reload reads the current configuration, reconnects the selected MCPs and refreshes their tools
and resources. Removed entries are disconnected; disabled servers stay disabled. It does not
restart Redcode, close your session or erase its history. Tools become available on the next
model turn. Reload between tool calls: a call using a connection that is restarted can fail.
Configuration errors keep the existing connections, and individual connection failures appear
in `/mcps` so you can fix the server and retry.

## Repository protection and YOLO

Repository preflight is part of the harness. Before coding, the agent calls
`worktree_prepare`, records the checks in its task checklist, reads the returned worktree's
instructions and files, and uses its absolute paths for edits and commands. The tool creates
or resumes a worktree belonging to that session. A new branch in the original checkout does
not satisfy the requirement. Non-Git directories can be edited directly.

The mandatory checklist covers repository/root identity, branch, existing changes, linked
worktree placement, applicable instructions, and the paths used for edits and validation.
Normal `git push` is allowed, including from the original checkout. Native file tools reject
source writes to the primary checkout, including through symlinks; commands that may write
must run in the task worktree. Read-only inspection and safe worktree creation remain available.

| Operation | Default policy |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `git reset`, `git stash`, `git clean` | Blocked, including their variants |
| `git restore`, `git checkout`, `git read-tree`, `git checkout-index`, `git update-ref` | Blocked |
| Forced/deleting pushes, forced branch changes/deletions, discard switches | Blocked |
| Worktree removal/pruning and reflog expiration | Blocked |
| Normal commits in the task worktree and normal `git push` | Allowed under configured permissions |
| `--auto` | Approves permission requests while keeping explicit denials and repository protection |
| `--yolo` / `--dangerously-skip-permissions` | Disables repository restrictions, mandatory worktrees, permission denials and tool filtering for the local harness process |

YOLO is shown explicitly in the TUI and remains active until that process exits. It is distinct
from the normal/auto toggle. A client attached to a separate server does not change that
server's execution policy; the server can be started with `REDCODE_YOLO=1`.

Plan and Design prepare their artifact worktree automatically, while session records, caches
and audit storage remain managed by the harness. Existing plans are copied without overwriting
a worktree draft. A new worktree starts from HEAD: local source changes remain untouched and
must be inspected before relevant material is copied into the task. Worktrees are retained at
delivery rather than automatically removed.

The shell guard conservatively checks command text and explicit path arguments; it is not an
OS sandbox for arbitrary scripts or extension implementations. Those tools must follow the
same preservation policy. An invalid shell `workdir` is rejected before execution with the
session directory and recovery instructions; it never changes the directory of later calls.

## Modes

Build, Plan and Design are the three primary modes in the regular `redcode` TUI.
`Tab` cycles forward and `Shift+Tab` cycles backward: Build is red, Plan is gold and Design
is cyan. Switching mode changes how the agent handles your next message; it keeps the current
conversation. For a complete UI design walkthrough, see [Design Mode](#design-mode).

<img src="docs/modes/build.svg" alt="Build mode" width="100%" />

**Build** reads, edits and runs commands under your configured permissions and the
[repository policy](#repository-protection-and-yolo). Use it to implement an approved plan or work
directly on product code.

<img src="docs/modes/plan.svg" alt="Plan mode" width="100%" />

**Plan** explores the repository and writes the implementation plan under `.red/code/plans/`.
`plan_exit` reads and records the reviewed file before a handoff. In the TUI and SessionV2, the approved
revision and contents survive continuation and compaction. A Plan-only Goal stays in Plan;
entering Build requires approval or prior explicit execution authorization. Plan can edit its
implementation plan file with no experimental flag. If the model only wrote the plan in chat,
`plan_exit` explains where to save it before requesting approval.

<img src="docs/modes/design.svg" alt="Design mode" width="100%" />

**Design** builds interactive prototypes in a separate work directory, gathers review feedback,
and hands an approved revision to Plan. Its default permissions protect product files. It can
reuse application components and design-system evidence through authorized reads.

## Design Mode

Use Design to **see and try a proposed interface before implementing it in your app**.
The terminal conversation, prototype and browser review belong to the same work: you ask in
chat, inspect the proposal in the browser, and send feedback back to that chat. During Design,
the agent edits the prototype work directory; product implementation happens in Build.

**Start with the regular `redcode` TUI.** You do not need to launch `redcode design` or move to
the web app to use this workflow.

```mermaid
flowchart LR
  Ask[Describe the interface in Design] --> Prototype[Agent creates a prototype]
  Prototype --> Quality[Inspect and correct: up to two cycles]
  Quality --> Review[Try the reviewed version in the browser]
  Review --> Feedback[Send feedback to the same conversation]
  Feedback --> Prototype
  Review --> Approve[Approve a published revision]
  Approve --> Plan[Review the implementation plan]
  Plan --> Authorize[Authorize implementation]
  Authorize --> Build[Build changes and verifies the app]
```

### Walkthrough: explore dark mode for app-admin

1. **Open your project.** Run `redcode` from the repository directory. Use the current
   conversation, or `/new` if you want a separate conversation for this design.
2. **Select Design.** Type `/design`, or cycle with `Tab` / `Shift+Tab` until the prompt shows
   Design in cyan. This selects the agent; it does not create a prototype by itself.
3. **Describe the outcome in chat.** For example:

   > Explore dark mode for app-admin. Reuse its components and design tokens. Show the dashboard
   > and settings screen, including empty and error states, so I can try them before implementation.

   The agent identifies the target application, asks for missing information, and creates a
   design document and prototype. You do not need to choose an engine or write tool arguments
   to start this conversation.

4. **Let Design review its draft, then try it.** You do not need to invoke Unslop, OpenDesign,
   Impeccable or a separate audit command. For frontend work, Design automatically loads its
   quality playbook: first review structure and the main task, then craft and regressions.
   It uses rendered audits, reads the captures, fixes material issues and rechecks changed
   revisions, with at most **two correction cycles** before the first formal handoff. It stops
   earlier when no material issues remain, when a cycle makes no progress, or when you interrupt
   or request a quick preview. This is the agent's built-in workflow, not a scheduler that forces
   extra provider turns or a replacement for your approval.

   Audits inspect each variant at **390, 768 and 1440 px**, including initial and applicable
   scenario states, within a limit of six variants and 36 captures per audit; missing coverage
   is reported. Accessibility/layout failures and advisory signals (such as repeated card
   compositions, decorative glass, gradient headings or filler copy) come with targets and
   evidence. Signals are contextual: a legitimate product pattern or an explicit brand choice
   is not an error. They do not identify whether an interface was authored by AI.

   The agent keeps the review details with the revision and gives you a compact summary of
   corrections, checks and unresolved items. If rendering, image inspection or coverage is
   incomplete, it presents an **unverified draft**, never an automatic pass. The live preview
   can show work in progress while review is running, so you can steer at any time.

   **Try the preview.** When the agent publishes a revision, the browser review opens and
   its URL appears in the tool output. Click through the prototype and try different widths.
   Until a revision has been published, there may be no preview to display; opening the browser
   alone does not build one.

   **Variants are alternatives inside one revision.** Select a named tab to explore one at a
   time, or choose **Side by side** and select the second variant to compare. Each preview is
   interactive and scrolls independently. **Mobile (390 px)**, **Tablet (768 px)** and
   **Desktop (1440 px)** set the actual preview viewport width; **Fit panel** uses the available
   space. Wider previews scroll inside their panel without stretching the review page.

   **Add variant** opens a prompt such as “Try a warmer palette with denser navigation”. The
   request goes to the same conversation, preserves the existing alternatives and asks the
   agent to publish a new revision. Select **New revision available** when it arrives. Your
   unsent review notes remain separate. For older prototypes with alternatives stacked in one
   page, **Separate existing variants** asks the agent to organize them into tabs; existing
   HTML is not split by guesswork. The revision selector remains the history of published snapshots.

5. **Send changes from the browser or chat.** For example, annotate the background with
   “This is too dark; keep more contrast between cards and the page” and click **Send feedback**.
   Unsent notes remain drafts in the browser. Submitted feedback names the revision and returns
   to the same terminal conversation. The agent adjusts the prototype and publishes another
   revision. Repeat until you are satisfied. Feedback sent during an active turn is handled at
   a safe turn boundary.
6. **Approve the proposal.** Click **Approve this revision** in the browser, or tell the agent
   “I am happy with this version; finish the design and prepare the implementation plan.” The
   agent asks for approval before recording the handoff. Approval freezes the chosen revision
   as the implementation reference and normally moves the conversation to Plan.
   The confirmation names the **selected variant** (the first preview when comparing side by side).
   Approval saves that selection together with the complete immutable revision. Without marked
   variants, it records the entire revision. The browser shows progress and confirmation;
   **View approved decisions** shows the saved reference even after newer drafts are published.
   The TUI shows a compact approval notice with a shortcut back to the review.
7. **Review the plan, then authorize Build.** The plan explains how to apply the approved design
   to the actual app. Approve that implementation before Build changes product files. A working
   prototype and an approved design are not, by themselves, an implemented feature. After the
   implementation, ask the agent to verify the interactions and compare the app with the approved
   revision.

### Commands in the regular TUI

These are the current behaviors. `/design` selects a mode; it does not currently combine the
conversation picker and browser preview into one command.

| What you want to do                            | Command or control               | What happens                                                                                                          |
| ---------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Explore a UI in the current conversation       | `/design` or `Tab` / `Shift+Tab` | Selects Design; send a message describing the work                                                                    |
| Start a separate conversation for a design     | `/new`, then `/design`           | Creates a fresh conversation, then selects Design                                                                     |
| Find an existing Design conversation           | `/design-open`                   | Opens a searchable modal with prototype names, conversation titles and state; Enter resumes the selected conversation |
| Find any existing conversation                 | `/sessions` or `/resume`         | Opens the regular session picker                                                                                      |
| Open the current conversation's browser review | `/design-review`                 | Opens its review page; does not change mode or create a prototype                                                     |

**Version availability:** `/design-open` is introduced in [PR #178](https://github.com/reddb-io/redcode/pull/178)
and is not in v0.23.1. Until you install a release containing it, use `/sessions` or `/resume` to
select the conversation, then `/design-review` to open its preview.

Names such as `design_document`, `design_preview` and `design_exit` in the transcript are
**tools called by the agent**, not slash commands you need to run. They create the document,
publish a revision and request approval, respectively.

### Return to a design later

Open `/design-open`, search by prototype or conversation name, and select the conversation.
The picker only lists the current workspace. Several prototypes in one conversation appear
together, and Design conversations without a document yet are included as **Not started**.

Resuming preserves the conversation's history and current mode. It does not send a message,
start model execution, open a browser or reopen an ended review automatically. Use
`/design-review` to see its preview. If you want to explore more changes after a handoff to Plan
or Build, select `/design` again and describe the changes. If the conversation has several
prototypes, name the one you want to continue. Explicitly ask to reopen a review that you ended.

### Review and assets

- Annotate elements or selected text, attach reference images, and submit feedback. Drafts stay
  on the reviewing device until sent; submitted feedback is stored durably before success is
  reported. Steering reaches the agent at a safe provider boundary.
- Select published revisions, compare directions, restore an earlier revision, and publish
  CSS custom-property adjustments. Restoring creates a new revision and preserves the approved
  baseline.
- Review layouts and declared interaction scenarios at mobile, tablet and desktop widths.
  Accessibility checks and comparison with the approved design retain reports and screenshots.
- Edit Mermaid diagrams through an Excalidraw whiteboard and send the scene and PNG as feedback.
  Its editor bundle is downloaded on demand, or supplied through `REDCODE_WHITEBOARD_DIR`.
- Generate or edit images through connected MCP/plugin tools that declare image capabilities.
  Imported assets retain their source tool, hash and version. Redcode does not include a paid
  image service or bypass the connected tool's permissions.
- Ask for an animated SVG and export it as GIF. The SVG stays editable; rendering captures its
  CSS/SMIL animation locally. Export jobs expose progress, cancellation and downloads. Standalone
  HTML export embeds local resources; unsupported external references must be localized first.

React and Solid prototypes resolve their framework from the target application's installed
dependencies. Project Vite configurations and arbitrary build plugins are not executed; supply
local fixtures for routing, data providers or other application services. Prototype frames are
sandboxed, and their assets must be local. First use of browser rendering or component building
may need network access to prepare its runtime dependencies and Chromium.

### Approval and implementation

Approval freezes the published source, selected variant, decisions, scenarios, asset metadata,
feedback and audit evidence into a typed approval package. Plan and Build automatically receive
the approved objective, constraints, decisions and acceptance criteria on each turn, including
after resuming or compacting the conversation. The chat contains a short handoff; the complete
review history stays in storage. The agent can call `design_read` for decisions, scenarios, assets,
feedback, audit evidence or an exact prototype file without reopening Design.

A newer draft does not replace the approved reference. Approving a different direction returns
to Plan; review and approve an updated implementation plan before executing its changed scope.
Historical approval packages remain readable and are not rewritten; packages created before
variant selection was recorded cannot identify a chosen variant.
The handoff updates only the Design-owned section of `plan.md`, preserving manual work. A Goal
configured to stop after Design records approval and stays in Design; otherwise the normal
handoff selects Plan. Build begins through an authorized Plan handoff.

### Other interfaces (optional)

The web app displays the review in its **Design** tab. The optional `redcode design` command
starts a separate SessionV2 terminal with its own command set. It is not required for the
regular TUI workflow above.

**Only inside the `redcode design` terminal:** `/review` opens the browser, `/status` shows the
session and pending requests, `/stop` or Ctrl+C interrupts execution, and `/quit` exits.
Reopen that terminal with `redcode design --session ses_existing_v2`. There, `/resume`
explicitly continues model execution; in the regular TUI, `/resume` opens the session picker.
Opening an existing session or reconnecting does not restart execution automatically.

The optional terminal prints completed text and tool output as durable events arrive.
Provisional token streaming and migration of the full-screen TUI renderer remain future work.

### Files and compatibility

| Location                                             | Contents                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| `.red/code/design/<designID>/work/`                  | Editable prototype source and local assets                           |
| Design storage in SQLite and content-addressed blobs | Revision history, feedback receipts, asset provenance and job status |
| `approvals/<revision>.json` in the design storage    | Frozen approval package                                              |
| The plan's marked Design section                     | Reviewed scope and evidence for the implementation handoff           |
| `DESIGN.md` or `.red/DESIGN.md`                      | Project design guidance used as source evidence                      |

New documents use the shared revision and asset store. When continuing a pre-0.22 prototype,
`design_preview` still accepts its original `path`: it imports the source into a new document,
keeps private review files out of the published snapshot, and preserves the original directory.
TUI feedback and approvals return through `/design/session/:sessionID`; web-app sessions
use `/api/session/:sessionID/design`.

If a preview cannot be assembled, the canvas shows the failing resource or server error
instead of an empty frame. Review actions stay disabled for that failed preview. Ask the
agent to correct the resource and publish a new revision, then select it or use **Refresh**.
Polling does not repeatedly retry the same failed revision; **Refresh** explicitly retries
it. Published revisions are snapshots, so editing a source file alone does not repair an
older revision.

See [Design Studio](specs/design/studio.md) for storage, permissions, exports and MCP configuration,
and [Design terminal](specs/design/terminal.md) for the optional terminal's connection and interaction commands.

## Monitors

In the full-screen TUI, ask Redcode to **run a long command in the background** or
**watch an external job until it is ready**. Open **`/monitors`** to see this session's
monitors, inspect the latest result, or stop monitoring. The list refreshes automatically.

There are two execution patterns:

| Pattern                               | What Redcode executes                                                          | When it resumes the conversation                                                |
| ------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| A synchronous command that takes time | Starts the command once; the same process continues after the chat is released | When it exits, fails, or reaches its deadline                                   |
| An external asynchronous operation    | Repeats an approved status command referencing the existing job                | When the success/failure condition matches, or the observation deadline expires |

For example: “Run the tests; let me keep chatting while they run,” or “Deployment
`job-42` is already submitted. Check its status every 10 seconds and continue when it
reports `succeeded`; report `failed` immediately.” Status commands must only observe
the existing operation. Never repeat the command that submits a deployment or creates a job.

The model uses `bash` with `monitor` options:

```json
{
  "command": "customcli status job-42",
  "timeout": 30000,
  "monitor": {
    "mode": "poll",
    "wait_ms": 1000,
    "interval_ms": 10000,
    "deadline_ms": 3600000,
    "success_contains": "succeeded",
    "failure_contains": "failed"
  }
}
```

Use `mode: "once"` for a command that should execute once. `wait_ms` controls how long
the initial tool call waits (default 1 second, maximum 60 seconds); it **does not kill
the command**. `timeout` limits each shell execution. `deadline_ms` limits the entire
monitor (default 1 hour, maximum 24 hours). A successful check requires exit code 0 and,
when specified, the success substring. The failure substring takes priority. A nonzero
exit ends a one-shot monitor as failed; a poll keeps observing. Prefer compact status
output because condition matching uses the shell's bounded captured result.

While monitors are running, the agent can do independent work. When it yields, the
task and Goal continuation loops wait without polling the model. Completion returns
one bounded, synthetic result to the originating session, with monitor identity,
status, exit code, and a retained output path when available. Newer user instructions
still apply. The `monitor` tool supports `list`, `get`, `wait`, and `cancel`; controls are
restricted to the current session. There are at most eight live monitors per session,
and automatic follow-up chains are limited to three monitors per user request.

**Stop monitoring** terminates the local command/check and suppresses its automatic
continuation. It does not cancel a job running in an external service. Stopping the
session also stops its monitors. Status and the last result are persisted, but a
process restart does not restore process handles, rerun commands, or resume observation
automatically: inspect the external job before starting a new status monitor. Webhooks
and log-stream readiness triggers are not part of this initial implementation. These
controls currently belong to the full-screen TUI runtime; the separate V2 SDK session
runner retains its synchronous shell behavior.

## Tasks

For a request with several steps, the agent is instructed to record every requested item,
including verification, and start working in the same turn. Simple questions do not need a
checklist. The regular TUI shows tasks in its sidebar and tool results; both session runtimes
use the same persisted task store.

| State       | Meaning                                                         |
| ----------- | --------------------------------------------------------------- |
| Pending     | Requested work still to do                                      |
| In progress | The current task; the next pending item advances automatically  |
| Blocked     | Unfinished work with a concrete obstacle, shown beside the task |
| Completed   | Work the agent reports as verified                              |
| Cancelled   | Work removed from scope, with an explicit reason                |

Updating one task keeps the others. Each task has a stable ID, a revision and stored change
history. The agent uses the latest ID and revision to update it; a conflicting stale update
is rejected. Older task lists remain readable, and unknown historical states appear as
blocked until reconciled. Blocked and cancelled updates require a reason.

When the model tries to finish with actionable tasks remaining, the harness asks it to
continue, within the agent's limits and permissions. After seven such reminders in a run,
execution pauses with a recorded continuation-limit reason; pending and active tasks keep
their states. Ask the agent to continue to resume that work. Independent
work can continue while another task is blocked. If every unfinished task is blocked, an
active Goal is marked blocked too. To resume, resolve the obstacle and ask the agent to
reopen the relevant task.

The workflow is **request → tasks → execution → evidence → completion**. New tasks retain
an exact quote from the request and an acceptance criterion. Before an implementation
handoff, Plan supplies a structured list of deliverables and verification steps. Approval
creates tasks linked to that immutable revision; approving it again keeps their progress.
Plan-only Goals can stop with a ready plan. New approved revisions preserve earlier work.
The agent is responsible for decomposing the entire request and assessing semantic coverage.

Both runtimes restore current task IDs, criteria, sources and blockers from storage in the
model context, including after compaction or resumption. Completed work is summarized;
the agent can read the full list and recent tool evidence with `todowrite({"todos": []})`.

Completing a task linked to a request or Plan requires a successful tool result from that
session and an explanation of how it satisfies the criterion. Evidence includes its message
ID, so repeated provider call IDs cannot select a different result. The runtime rejects missing,
failed, bookkeeping and outdated evidence. Subsequent edit or shell actions conservatively
invalidate earlier evidence and reopen affected completed claims for verification. Run the
final checks after implementation before closing the task set. This verifies provenance and
freshness, not semantic correctness: the model must judge whether a check actually proves
the requested outcome. Historical tasks without a source remain compatible.

Cancelling tracked work requires a reason and an exact quote from a later user instruction
removing it from scope. Tasks track execution; [Goal](#goal) adds its separate criteria,
gates and completion review.

## Context compaction

When a conversation approaches the model's context limit, Redcode summarizes older history
and keeps recent context for continuation. Both runtimes preserve the latest original user
request as serialized text outside the model-generated summary, even across repeated
compactions. Attachment references are retained; this does not preserve image or file bytes
in the model context.

A new checkpoint becomes active only after the summary stream finishes successfully, the
summary is nonempty, and the estimated replacement context is smaller than its source.
An interrupted, truncated, empty or growing summary leaves the previous history active.
Messages received during summarization remain available for continuation.

The shared summary instructions preserve applicable constraints and approval scope, give
later corrections precedence, and distinguish verified work from pending work. Current
Task and Plan state is restored from storage, so a summary cannot mark a task complete.
These structural checks do not prove that the model preserved every older detail correctly.
Both runtimes can prepare a summary while the next provider turn runs. Preparation starts
within 10% of the existing compaction threshold, capped at an 8,000-token lead. Each active
session keeps at most one candidate. Applying it still happens between provider turns,
after checking the source history and model; messages added since preparation are retained.
Rewritten history or changed model settings invalidate the candidate. If it is unsuitable,
Redcode falls back to ordinary compaction.

Preparation stops when the session's current execution ends or is interrupted. The Core
limits each preparation to two minutes; the legacy runtime follows its existing auxiliary
timeout (ten minutes by default). This overlaps work to reduce waiting; it does not make the
summary model faster. A discarded candidate can still incur provider usage. To disable
preparation while keeping automatic compaction:

```json
{
  "compaction": { "auto": true, "background": false }
}
```

## Goal

<img src="docs/modes/goal.svg" alt="Goal" width="100%" />

`/goal` gives the current session a definition of done that persists across provider turns. It
continues within its mode and budget until the objective is verified, blocked or paused.

```text
/goal implement the settings form; verify: exercise valid and invalid input; gate: bun test test/settings;
constraints: preserve the existing API
```

Put verification criteria, constraints and stopping conditions in the objective. `gate:` clauses
become executable checks and obey shell permissions. In the full-screen TUI, `/goal` opens a
dialog; in `redcode design`, `/goal objective` starts directly.

SessionV2 stores the Goal's scope, status, budget, evidence and checks. `goal_complete` reads
actual artifacts, checks pending work, runs gates and requests an independent review. Completion
is finalized after sibling tools and their hooks settle; changed evidence or new steering can
invalidate the proposal. A successful review does not authorize a broader task.

Each provider attempt consumes budget, including retries. Exhaustion pauses the Goal rather than
marking it done; provider failure blocks it with a reason. Reported primary and review usage is
retained even when a verdict is rejected or execution is interrupted. The default limit is 50
attempts for SessionV2; the legacy TUI defaults to 20, configurable under `experimental.goal`.

| Control | Full-screen TUI | `redcode design` |
| --- | --- | --- |
| Start or inspect | `/goal` dialog and Goal status line | `/goal objective`, `/goal-status` |
| Pause | `/goal-pause` or Ctrl+C | `/goal-pause` or Ctrl+C |
| Change total budget | `/goal-budget` opens a dialog | `/goal-budget N` |
| Continue | `/goal-resume` | `/goal-resume` |
| Remove | `/goal-drop` | `/goal-drop` |

After exhaustion, increase the total budget and then resume. Opening an existing session or
reconnecting its event stream does not automatically resume execution. A Goal started in Plan
stays there unless execution is explicitly authorized.

The legacy TUI uses its own Goal judge and recorded tool/gate results. SessionV2 adds durable
revision checks and evidence history; its stronger completion guarantees do not retroactively
apply to legacy sessions. See [Goal and mode continuity](specs/goal-modes.md) and the
[CLI reliability report](specs/cli-reliability.md) for validation and limits.

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

Requires Bun 1.4.1, matching the toolchain pinned in `package.json`.

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
