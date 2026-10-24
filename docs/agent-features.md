# Agent features

This guide describes coding-session features. Slash commands are entered in the TUI, not in the Console. For component boundaries, installation and remote execution, start with the [README](../README.md). Distributed Redcode workers have a [separate guide](distributed-workers.md).

## Agents workspace

**Desktop / web app.** Open **Agents** in the siderail, or use `Ctrl+Shift+A` (`Cmd+Shift+A` on macOS).
Its sidemenu groups **Sessions**, **Tasks**, **Inbox**, **Harnesses** and **Remote workers** under
**Execution**; project environments, isolated workspaces and worktrees under **Workspaces**;
and **Machines** plus **Hosts and resources** under **Infrastructure**.
Select one host or view all configured hosts. The selected
section and host are stored in the URL and survive reload; the desktop can restore the Agents page.
On mobile, open **Agents** in the bottom navigation and use the section selector in its header.
Changing sections keeps the selected host. **Browse** opens the sidemenu to change the host scope.

- **Sessions** groups root sessions and subagents by status. Filter by session/project/worktree,
  send a steering or queued instruction, interrupt running work, or open its conversation.
- **Tasks** selects a session on each host to follow its shared objective, task completion and
  prerequisite acceptance. Its dependency list links prerequisites to their task details, shows
  recorded blockers and opens the assigned child sessions. Delegated revisions, unsettled work and
  outdated contracts remain distinct from completion evidence. The read-only `session.todo.graph`
  API exposes the same task graph and assignments used by the executor; reading it does not start
  work or accept results. Inspect delegated execution status, response excerpts, observed checks,
  stale contributions and files changed by multiple prerequisites. **Prepare combined candidate**
  binds accepted local Git contributions to a target checkout selected explicitly. Preparation shows
  the combined diff without updating checkout files or refs. Verification and acceptance belong to
  the session; **Review bound candidate** then enables explicit application of that exact accepted
  candidate. Changed task revisions require another review, and a truncated diff prevents confirmation.
  An uncertain application retains its original request identity; retry it to reconcile an admitted
  operation. Refresh also reloads recorded application receipts. Integration currently requires the
  trusted host connection and local project worktrees; it does not combine checkouts across hosts.
- **Inbox** lists permissions and forms from active runtimes without loading transcripts. Choose a
  request to answer it. Worker permissions and questions are answered through their coordinator,
  using its stored worker credential and recorded task assignment. Requests already answered or
  belonging to another assignment are refused. Protected permissions remain visible with automatic
  approval enabled. Other forms, including credentials, require the assigned session's normal client.
  On mobile, the selected request appears before the list. **Back to requests** returns focus to the
  original row without sending an answer; reopening the same question keeps its draft choice.
- **Hosts and resources** provides a searchable host list and one selected resource inspector showing
  logical CPUs, sampled CPU usage, OS free/total RAM and the Redcode process's memory, considering visible
  runtime/container limits. Mobile details replace the list; **Back to hosts** preserves its search.
  CPU and available RAM have labelled meters; an unavailable reading has no meter.
  The first CPU sample is unknown. Measurements refresh for the open inspector or when queued tasks need admission;
  failed/disconnected hosts do not display cached values as live. These figures do not reserve RAM or
  enforce OS quotas. Optional [worker task requirements](distributed-workers.md#resource-aware-admission) control admission through the coordinator.
- **Machines** guides connection, server access verification, project access verification and the
  choice to open a session or register a worker checkout. Going back retains the draft; a changed
  target requires new checks. Verification does not start an agent or dispatch work.
- **Remote workers** filters task reports by status or searches their prompt, identifiers, worker,
  checkout and capability tags. **Execution details** shows the saved assignment and its current
  queue, input or recovery state. Instruction, interruption, recovery and patch-review
  actions belong to the selected task's inspector. On mobile it replaces the inventory; returning preserves
  filters and unsent instructions. A stale report disables execution controls, and a removed task
  stays explicitly unavailable. Transition times and duration are not recorded in this report.
  **Tasks**, **Workers** and **New batch** separate execution, machine setup and
  composition without discarding drafts. A batch progress indicator counts successful
  executions. Desktop switches between **By worker** and **List** views of the same
  inventory; mobile uses the compact list. Grouping follows recorded assignments,
  with unassigned work separate and worker reachability visible.

Unavailable locations/tasks are reported explicitly, so incomplete inspection is not presented as an
empty inbox. Servers without the new endpoints remain usable for sessions and show unavailable states
for the new views. Organization users receive only their authorized worker assignments; broad host
inbox/resources APIs require infrastructure administration or the existing trusted server connection.

See [distributed workers](distributed-workers.md) for registration, credentials, independent checkouts,
recovery and collecting changes.

**Harnesses**, **Machines** and **Worktrees** extend this workspace with external Claude Code/Codex
sessions, guided remote registration and a create/review/integrate/archive/restore workflow.
The harness's **Native sessions** tab contains session selection and creation; **Agent setup**
contains installation, executable configuration and sign-in. Changing tabs retains unsaved fields.
On wide screens, selected session details sit beside this workspace; mobile opens those details on their own.
See [external coding agents and worktrees](external-harnesses.md) for capabilities and host ownership.

**Project environments** stores reusable preparation and validation recipes. Run a Docker Compose
stack or existing project scripts on the selected host, with separate execution state per worktree.
See [project environments](project-environments.md) for setup, ports, Vault bindings and recovery.

## Tool discovery

Code Mode is always enabled on the agent server, so Desktop, web and CLI sessions use the same
tool discovery. The model receives a compact catalog and can search connected MCP tools through
`execute` when it needs a tool that is not listed inline. The inline catalog targets approximately
2,000 tokens; this is not a limit on the conversation, tool results or the complete request.

Each tool call keeps its permission checks. Execution time, tool-call count and output size remain
bounded. `experimental.code_mode` configures execution limits; the obsolete `enabled` field is
ignored. S1 catalog ranking is a separate opt-in.

## Modes

A session runs one of four primary agents. `Tab` cycles through them (`Shift+Tab` goes back), and the
switch is durable: the next prompt is admitted under the agent you picked. Each mode is a different
answer to what the agent is allowed to touch.

<img src="features/build.svg" alt="Build mode" width="100%" />

**Build** is the default. It reads, edits and runs under the permissions you configured, and it
delegates to subagents when the work fans out. The other modes are defined by what they take away from it.

<img src="features/plan.svg" alt="Plan mode" width="100%" />

**Plan** reads everything and changes nothing but the plan file. Use it when the shape of the work is the
question: the agent explores, asks and writes the plan down, and `plan_exit` asks whether to switch to
build and start on it.

<img src="features/design.svg" alt="Design mode" width="100%" />

**Design** is for when the question is what something should be, not how to build it. See
[Design mode](#design-mode).

<img src="features/question.svg" alt="Question mode" width="100%" />

**Question** answers investigative questions about the codebase with read-only tool access. Nothing is edited.

## Vault

<img src="features/vault.svg" alt="Vault" width="100%" />

Agents need credentials to do real work: call an API, log in and fetch a token, push to a registry. They
should not need to read them. The vault keeps secrets **per project** and lets the model work with a
reference such as `{vault:github-token}` instead of the value.

- **Pasting a secret is safe.** A high-confidence secret in your prompt is moved into the vault before
  anything is stored, and the transcript, the event log and the model only ever see the reference.
- **The model can use a secret.** References in shell commands and env-style file writes are resolved by
  the harness at the last step, in a way that survives shell quoting. Tool output is scrubbed of every
  known value on the way back.
- **The model can obtain one.** A token that a tool prints, such as a login response, is captured
  automatically, so the next call can use it without the value ever entering the context.
- **The model can ask for one.** `vault_request` opens a masked input for you. The model gets a reference back.
- **Hosts are bound.** The first time a secret is used against a host, you are asked once; after that
  the secret only goes where you approved.
- **The model is told how.** The harness explains the vault to the model in its instructions, and lists the
  names it may use, never the values.
- **Restricted content is flagged.** S1 marks messages that carry restricted content, protects them, and tells
  you the secrets were removed from the context. `/compact` and session titles pass through the same redaction.

A project's secrets live where your project already keeps them: the `.env` file at the root of the
repository, which Redcode adds to `.gitignore`. `GITHUB_TOKEN` in the file is `{vault:github-token}` in a
prompt, a pasted `GITHUB_TOKEN=ghp_…` is written back under that name, and edits you make to the file are
picked up while a session runs. Worktrees share the main checkout's `.env`. Only variables named like
credentials, or holding a recognized secret, are hidden from tool output, so `PORT` stays readable. A token the
agent captured from a tool's output is short-lived and stays in memory only.

Manage secrets with `/vault`, `redcode vault set NAME` (masked prompt, or a piped value), or
`redcode vault import other.env`. Vault coverage is measured in CI against a 90% line target.

## S1 · S2 dual reasoning

<img src="features/intelligence.svg" alt="S1 and S2 dual reasoning" width="100%" />

**S2** generates responses and does the agent work. **S1** evaluates candidates with typed
TypeSafe/JEV questions, so a claim is checked before you trust it. **Single** reasoning uses S2 alone;
**dual** adds S1. Run `/dual` (or `redcode setup`) to pick and check the models, and `/intelligence`
to inspect the current models, the effective mode and recent evaluations. An unavailable, inconclusive
or rejected evaluation is shown as such, never as an approval. See [reasoning roles](system-one.md).
`/setup` remains an alias for `/dual`; `/reasoning` changes the mode for the current session.

S1 prompt classification runs **in parallel with S2**, including gathering its sources.
When it finishes, persisted advice steers subsequent Steps for the same user request.
A newer user correction takes priority; an old assessment cannot steer that new request.
Late feedback still contributes to the session's frustration thermometer without restarting completed work.
Final response review and mandatory approval checks keep their existing policies.
This removes the classifier's initial wait. The [published 0.71.3 study](evaluations/reasoning-0.71.3-2026-10-02.md)
has not demonstrated a coding accuracy or speed gain.

In dual mode, the vertical thermometer beside Context and S2 prompts track accumulated
friction with the agent's work: **0/5 means no accumulated friction; 5/5 means critical
friction**. Its single-column bar fills upward (`▯ ▁ ▂ ▄ ▆ █`) as repeated corrections,
rejected results and unresolved failures accumulate. Neutral messages such as "ok, continue" preserve the temperature; confirmed
improvement cools it gradually. It tracks the history of unmet expectations rather than
classifying the user's emotions. High or rising temperature asks S2 to revisit the failed
attempts, change its approach, verify the correction and clarify an ambiguous outcome.
Fewer than three reliable classifications means unknown. This reuses existing S1 results
without another model call; its quality impact has not yet been measured.

The latest **published 0.71.3** calibration used three new coding families, with two
repetitions: **6/6 valid passes in both modes**, **29.5% more dual cost** and
**59.6% more aggregate execution time**. All six matched baseline costs stayed
below 2x. The separate S1 detector distinguished three defective candidates from
three correct ones; this does not establish agent improvement. The repair
experiment exceeded 2x cost, and one self-review comparison has an interrupted,
unpriced response. Reserved cases were not dispatched. See the
[measurements, HTTP receipts and limitations](evaluations/reasoning-0.71.3-2026-10-02.md).

An earlier [local coding calibration](evaluations/reasoning-coding-2026-10-02.md), using an unpublished CI binary with
Mimo V2.6 Pro and JEV-1.13 found **12/12 passes in both modes**, with **34.3% more
dual cost** and median latency of **81.66s versus 49.52s**. Two matched costs
exceeded 2x. The verification experiment stopped on a five-minute execution
timeout and has incomplete cost evidence. Reserved-case collection stopped at
11/24 executions on another five-minute timeout, with another matched cost
above 2x. Collection is closed; neither a coding accuracy gain nor compliance
with the per-case cost ceiling was demonstrated.

In an earlier read-only diagnostic experiment, dual passed **39/40 cases (97.5%)** against
single's **35/40 (87.5%)**, a gain of **10 percentage points**. Estimated total S1+S2 cost
increased **13.8%**; median latency increased from **3.13s to 4.44s (42% slower)**.
All matched pairs stayed below 2x estimated cost, with no observed paired regression.
This small read-only sample used GPT-4.1 mini with JEV-1.13 and an experimental verification
candidate. It does not establish general coding gains or validate every later change.
See the [results and limitations](evaluations/reasoning-accuracy-2026-10-01.md),
the [earlier unfavorable baseline](evaluations/reasoning-0.70.3.md), and the
[current evaluation plan](plans/dual-reasoning-evidence.md). The 2x criterion is an
evaluation gate; runtime budgets cannot guarantee a ratio against an unobserved single run.

The [coding evaluation harness](reasoning-evaluation.md) adds twelve repair projects
with actual source edits, test execution and independent behavioral checks. It compares
pinned S1/S2 pairs on separate calibration and held-out families, rejecting incomplete
evidence and unknown costs. Coding calibration and reserved-case results remain separate;
the earlier diagnostic gain does not establish coding improvement.

The opt-in **S1 code review and repair** experiment reviews actual candidate code
and permits one scoped correction with bounded Steps and existing test commands.
The harness also measures S1 defect detection separately and compares dual with
**single code self-review** under the same repair limits. These mechanisms have
not yet demonstrated an accuracy gain; see the [evaluation procedure](reasoning-evaluation.md).
A separate `challenge` corpus adds six new families for calibration and reserved
validation, including concurrency, conflict resolution and parser state. Its
cases have not yet been measured with models; historical results remain separate.

## Goal

<img src="features/goal.svg" alt="Goal" width="100%" />

Every mode is turn by turn: the agent answers, the harness waits for you. `/goal` changes that for one
session. You give it a definition of done, and the harness keeps the agent on it across turns until it
holds, until it is blocked, or until the budget runs out.

```
/goal make the design suite pass; verify: bun test test/design; gate: bun test test/design;
constraints: do not touch the app package; stop when: a test needs a network
```

Free text is the objective. The optional fields, one per line or separated by `;`, are the contract the
judge holds the agent to:

| Field                     | What it fixes                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `outcome:` / `done when:` | What has to be true at the end                                                       |
| `verify:`                 | How the agent should prove it                                                        |
| `gate:`                   | A shell command that must exit 0 before the goal can be judged done; several allowed |
| `constraints:` / `scope:` | What may not be touched or changed                                                   |
| `stop when:`              | What should make the agent stop and ask instead of pushing on                        |

At the end of every turn the gates run, and a failing gate feeds its output into the next turn. Then a
small judge reads the objective and the last answer and says **DONE**, **CONTINUE**, **BLOCKED** or
**WAIT**. The objective lives in session metadata, not the transcript, so compaction cannot paraphrase it
away. The agent may claim completion with `goal_complete`, but the next judgement consumes that claim
rather than trusting it. `Ctrl+C` pauses a goal, and so does a new process: a loop never restarts itself.
`/goal-pause`, `/goal-resume` and `/goal-drop` do what they say.

For multi-step work, tasks carry acceptance criteria and may depend on verified prerequisites. Approved
plans preserve those relationships when they enter Build. Independent tasks can run in parallel; a
cancelled prerequisite does not release its dependents. The agent can inspect which tasks are ready,
which are waiting, and which child sessions are assigned to them.

A subagent can be linked to a task with `taskID`. It receives the task contract and accepted prerequisite
results alongside the inherited objective. Its response goes back to the coordinator for reconciliation:
the coordinator must run a fresh verification after delegated work settles before completing the task.
Changed contracts require an updated delegation, and later edits or changed prerequisite evidence reopen
affected completed tasks. An objective cannot finish while tracked delegated work or unfinished tasks remain.

For a task that integrates several prerequisites, `task_reconcile` collects their contributions in one
report. Each entry identifies the originating session and prompt, execution outcome, result review,
parent acceptance, recorded checks and observed changed paths. Long responses keep a bounded excerpt,
full-content hash and source message reference. The report lists observed file overlaps and incomplete
write coverage so the coordinator can inspect the source sessions and verify the combined changes.
`executionSettled` describes whether the required work has stopped; `acceptanceReady` describes whether
every prerequisite has current parent evidence. Failed, blocked, cancelled and stale inputs remain
explicit. Reads preserve task state, and the report itself cannot prove completion.

Clients can read the same projection with
`GET /api/session/:sessionID/todo/:taskID/reconciliation`, optionally supplying `revision` to reject a
changed integration task. Background completion notices retain their existing delivery and recovery;
the coordinator collects the required results after those notices rather than polling active children.

When results live in separate Git worktrees on one host, the worktree lifecycle API can prepare an
ordered set of pinned commits as one candidate, including divergent histories. Preparation leaves
checkout files, indexes and branches in place and reports conflict paths without starting a checkout
merge. A client can create a validation worktree from the candidate commit, run the combined checks,
then apply that exact commit to the clean, idle target. Source and target revisions are checked again
on application. This host operation does not complete tasks or serve as their evidence; the coordinator
still owns acceptance of the integrated result. See [combined results](external-harnesses.md#combine-several-results).

Clients can call `POST /api/session/:sessionID/todo/:taskID/integration` with the task's `revision`,
`target` checkout and reviewed `targetHead`. The host selects the latest successful tracked contribution
of each accepted prerequisite, resolves its managed local checkout and prepares the joint commit.
A successful preparation keeps source task revisions, session/prompt identities, contracts, paths and
Git commit IDs in the task's `integration` field and revision history. Conflicts leave the task unchanged.
`task_reconcile` includes that binding with `contractCurrent` and explicit issues. Changed criteria,
accepted inputs, continued delegations or moved sessions require another preparation. Completion needs
a successful verification newer than preparation; the binding itself cannot prove completion.
Contract freshness does not attest current Git state or bind arbitrary shell checks to a commit.

## Design mode

<img src="features/design-flow.svg" alt="How design mode works: describe, prototype, preview, review, send to the agent, revise until settled, design_exit writes the plan, build implements it" width="100%" />

Design mode is for working out what something should be by building it. The agent writes an interactive
prototype, you review it in your browser, and what you decide becomes a plan. The agent cannot edit the
product in this mode, only the prototype, so nothing you say changes code until you leave.

- **Targets.** Prototype for the `web`, for an `app`, as `presentation` slides, or as a static `creative`.
- **Review in the browser.** Click an element, select text or a diagram node and leave a note. Nothing
  reaches the agent until you press **Send to Agent**. New published revisions update the revision
  picker and preview together, keeping your notes, selected screen and scroll position. Browsing an
  older revision keeps that selection until you open the latest one.
- **Mobile review.** The canvas fills the workspace. Open **Inspector** for Feedback, Assets, Details
  and Params; close it to return to the live prototype. **More → Preview settings** opens history and
  device controls. **More → Approve this revision** keeps the explicit approval step available.
- **Canvas navigation.** Mobile frames, slides and creatives have zoom, **Fit canvas**, **Actual size**
  and **Pan canvas** controls. Enable Pan to drag the canvas with a mouse or touch; turn it off to use
  prototype controls and scrolling. Focus the canvas for `+`/`-`, `0` (Fit), `1` (Actual size) and, while
  Pan is on, arrow-key movement. Annotations follow the view transform and keep unsent text. Web pages
  retain the responsive width selector.
- **Layout audit.** After every load the browser looks for cut-off text, controls outside the viewport and
  sideways scrolling. You choose which findings to queue as fixes.
- **Whiteboard.** Mermaid diagrams open in an Excalidraw whiteboard; your edits go back as a note and a PNG.
- **Your design system.** The agent reads `DESIGN.md` (or `.red/DESIGN.md`) and reuses the project's real
  components. Set `design.system` in `redcode.json` to point at it.
- **Run anti-slop.** The variant menu audits that direction, fixes the findings and publishes one new
  revision, with an optional focus. One final audit verifies the corrections before the agent stops
  for your review. Unsent notes and other variants are preserved; no changes means no new publication.
- **End-of-round review.** “Applying anti-slop” identifies a review of the published revision using a
  checklist for components, screens, flows or slides. It reuses the recorded brief, direction and
  design system, checks rendered evidence, and reports checked, pending and unverified items.
  Findings become pending Design tasks for the next requested round; review never starts an
  automatic edit/publish loop or approves the prototype for you.
- **Finish.** Approving in the browser captures the current preview as `$screenshot1` and attaches the
  image to the same session for Plan, alongside the approved decisions. The reference records the
  revision, variant, screen, viewport and scroll position, and retries reuse the original image.
  You can uncheck the capture in the approval dialog; an unavailable capture does not block approval.
  Ordinary feedback rounds do not capture screenshots. Browser capture renders the live DOM;
  video, WebGL and some browser effects may not reproduce exactly.
  `design_exit` writes the plan from the decisions and open questions recorded in `design.json`.

<img src="features/design-review.svg" alt="The review page: the prototype with numbered annotation pins, and the conversation panel with the queued notes and Send to Agent" width="100%" />

Prototypes live in `.redcode/designs/<name>/`. `redcode serve --hostname 0.0.0.0` lets you review from a phone.

Desktop opens published previews beside the session's chat. Embedded reviews omit the duplicate
conversation and agent reply, retaining annotations, feedback and approval. Standalone browser reviews
retain their conversation panel. Both modes use the same persisted Design tasks and revisions.
The Design renderer is a separate child process of the Redcode executable; it does not require a
second native runtime installation.

Open `http://localhost:35555/design` to create a Design session from a project
loaded in Redcode or resume an existing one. The browser connects once through
`redcode pair`; shared review links are scoped to their Design session.
The review shows the same persisted Design tasks as the CLI.

### Creative canvases and assessments

Choose **Creative (ads and artwork)** when starting a design, or run `redcode design --target creative`.
Use a square (1080×1080), portrait (1080×1350), story (1080×1920), banner (1200×628), or custom canvas.
Custom dimensions range from 64 to 4096 pixels per side. **Details → Canvas size** records dimensions
in a new revision; ask the agent to adapt the composition when changing placement. Each direction is
a variant. **Assets → Export PNG / Export PDF** exports the selected direction at its recorded size.
PNG uses the exact canvas pixels; PDF produces one page with corresponding physical dimensions
(96 CSS pixels per inch). Review the export before print production; this is not a PDF/X or CMYK workflow.

Open **Review → Design assessment → Analyze with System One** for feedback on the selected revision
and variant. Web, mobile and slides review hierarchy, message clarity, density and legibility, with
separate judgments about available interaction, technical or narrative evidence. Creative assessments
also classify archetype, persuasion lever, audience awareness, production style and explicit CTA.
These are advisory judgments, not conversion predictions or approval. Technical audits and built
implementation comparisons remain the evidence for implementation quality.

Assessment cards include the recorded evidence and limitations. In **Assets**, implementation checks
show their revision scope, severity counts, targets and suggested corrections. Design-system reuse is
shown only when measured; unavailable data is not a zero score. Opening a finding keeps it open when
the same results refresh. These summaries do not approve the design or claim that untested flows work.

The analysis uses your configured S1 without changing its model or provider. By default it sends
bounded visible text, layout measurements, brief and existing technical audit evidence. Checking
**Include rendered images (experimental)** also sends up to six rendered views to an endpoint that
supports TypeSafe image requests. The panel records scope, model, duration, reported tokens and cost;
the downloadable assessment includes its evidence and image captures. Missing configuration or
unsupported image transport is shown as unavailable, with no automatic retry or silent text fallback.
Further slides, states and offscreen content remain outside the sample. The agent can read assessments
through `design_jobs` and request them through `design_export` with `format: "analysis"` and optional
`visual: true`. An analysis does not edit or approve the design.

Use PNG as the default image delivery format for artwork with text and sharp edges. Preserve genuine
SVG assets as vector sources; HTML compositions and photographs are not automatically vectorized.
WebP is useful for optimized website delivery, but this canvas exporter currently provides PNG and PDF.
See the [image format guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types).

To let colleagues on your local network annotate the same prototype:

```sh
redcode service set hostname 0.0.0.0
redcode service restart
```

The port remains `35555`. In the review menu, select **Share on local network**
and send the generated link to your colleague. It uses your machine's LAN
address and stays on the owning server while the separate Design app renders
jobs. To return to local access, set hostname to `127.0.0.1` and restart.
The shared link grants review access for that session; it does not grant general
server access.

## RedRouter

<img src="features/router.svg" alt="RedRouter" width="100%" />

RedRouter is a provider that fronts many models behind one key. Redcode understands it natively: an
`auto` variant lets the router choose, pinned offers fix a model to a specific provider, model
suggestions surface what your key can reach, and the router's MCP tools are registered for you.

Redcode bundles a verified [models.dev](https://models.dev) provider catalog, including decision
models for compatible S1 adapters. Canonical model identity stays separate from the executable
provider ID, and specialized models stay out of S2. A RedRouter connection always uses its own
key-scoped catalog; remote discovery caching belongs to the router.

You can save multiple connections for RedRouter or any other provider. Run `/connect`, choose the
provider, then **Add connection…** to add another key or account. RedRouter connections can point
to different URLs. Connected providers appear first, followed by popular providers; each provider's
active connection comes first in its saved connections. Rename connections to distinguish machines
or accounts. `/dual` also lists active connections first and retains the connection selected for S2.

## Monitors

<img src="features/monitors.svg" alt="Monitors" width="100%" />

The agent uses monitors to wait for an HTTP endpoint, a file change or a process state.
`/monitors` shows active observations and their latest check in the existing rows. Progress
updates are bounded and coalesced; only completion can wake the session, respecting newer
instructions and paused goals. Completed monitors leave the drawer. Long commands use the
background shell, with their own output and completion notifications.

## Stop-loss and loop guard

<img src="features/stop-loss.svg" alt="Stop-loss" width="100%" />

Two safety nets watch every session. The **loop guard** notices an agent repeating the same call with the
same result. The **stop-loss** notices a session that keeps spending without making progress. Both were
calibrated to ignore normal work: an edit acknowledgement is not a repeat, and cached context is not spend
growth. There are no default cost limits. `/budget` sets a limit only when you ask for one, and a
model can never set its own.

## Compaction

<img src="features/compaction.svg" alt="Compaction" width="100%" />

`/compact` can take a focus (`/compact keep the migration steps`), runs in the background, and keeps
anchors: the user messages and decisions that must survive verbatim. Its output passes through the same
redaction as the vault, so a secret pasted earlier in the chat does not come back in the summary.
`/restricted` lists the messages marked as restricted content and lets you remove one from the context.

Summary compaction uses the explicit S2 transformations model when configured. Otherwise it can use
the `compaction` agent's configured model, falling back to the session model if that optional model is
unavailable. Native provider compaction continues to use its original backend.

When the session directory is inside Git, the completed checkpoint also includes a fresh **Repository Status**:
the active worktree's path and kind (main or linked), branch (or detached HEAD), and changed-file counts.
Tracked, untracked, staged, unstaged and conflicted changes are distinguished; a file changed both in the index
and working tree counts once in the total. Staged renames count as one file, and ignored files are excluded.
Discovery starts at the session directory, including a subdirectory, so a linked worktree records its own branch
and changes rather than those of the project's main checkout. Outside Git, no repository section is added.

The snapshot is collected when the checkpoint completes, including summaries prepared in the background,
plugin-supplied summaries and native provider compaction. It records state at that time; later Git changes
are reflected by the next successful checkpoint. Native checkpoints keep the provider's replacement window
and append the snapshot as readable context for the next request.

## Worktrees and the background service

<img src="features/worktrees.svg" alt="Worktrees" width="100%" />

`redcode --tmp` starts in a throwaway git worktree, and `/worktrees` (or `redcode worktrees`) lists,
creates, refreshes and cleans the project's worktrees. The server that holds your sessions can run in the
background, so closing the terminal does not stop them: `redcode service status|start|stop|restart`. If
it fails to start, the message says why.

Agents can manage checkouts with `worktree_create`, `worktree_list` and `worktree_remove` through
Code Mode. Removal is permission-gated, requires explicit force when needed, and protects the primary
checkout. Subagent completion and cancellation are tracked independently of the project's loaded runtime,
so unloading that runtime does not lose the pending job notification.

In Desktop and web, **Agents → Worktrees → Review changes** opens a focused diff with the
source checkout, integration target and reviewed revisions. On phones, the diff scrolls while
integration and archive actions remain accessible. **Back** returns to the originating worktree
without integrating or archiving. Archive remains a separate confirmation and preserves the
committed result as described in the [worktree lifecycle](external-harnesses.md#create-review-integrate-and-archive).

## Dictation

<img src="features/voice.svg" alt="Dictation" width="100%" />

The composer accepts structured dictation from [dit](https://github.com/reddb-io/dit) over a local,
process-scoped socket. Partial text is replaceable, committed segments accumulate, and finishing leaves an
editable draft. Voice input never submits the composer. See [voice input](voice-input.md).
