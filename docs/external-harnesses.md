# External coding agents and worktrees

The **Desktop / web app** controls these features through **Agents** in the siderail. Its sidemenu
separates **Executors**, **Machines**, **Worktrees**, the native Session inbox and the worker coordinator.
The host selector determines where an executable, credential, native session or checkout lives.
**Settings → Servers** also links to the selected host's tools. Normal setup uses these screens;
editing a configuration file is not required.

For a fresh worker checkout, **Agents → Isolated workspaces** builds a dedicated Linux container and
prepares a public Git repository automatically. Its setup and lifecycle are described in
[distributed workers](distributed-workers.md#prepare-isolated-workspaces-in-the-app). Worker-batch
placement still uses the native Redcode harness; the host-wide Claude/Codex adapters below do not
automatically enter the isolated worker pool.

## Run Redcode on the current server

Executors defaults to **Redcode**. Enter an existing checkout and choose **Start Redcode session**;
the app opens a normal native Session using saved Redcode settings. The external adapter inventory
is independent, so an unavailable Codex or Claude installation does not disable native sessions.
The session's normal permission, input and interruption controls remain in its conversation.

For native batches, open **Worktrees**, select a project and choose **Enable this checkout for batches**.
Review the proposed slot and confirm it. Registration uses the server's own listener and private
authentication without copying credentials into the browser or registry. Then use **Remote workers**
to compose and follow batches, selecting that local slot like another worker. Each enabled checkout
provides one slot; submitting a batch never creates worktrees automatically.

The CLI adapters below are explicit alternatives. Redcode execution does not spawn another Redcode
CLI, runtime or database. Host-administration permissions still protect slot registration; creating
an ordinary native Session keeps its existing authorization.

## Connect a remote machine

1. Open **Agents → Machines** on the coordinator you want to use.
2. Choose **Add server**. Enter a reachable server/pairing address, or use **SSH** in the desktop menu.
   The existing SSH bootstrap checks the platform/version, installs the server when needed, starts
   its service and forwards its port. Authentication challenges and progress appear in that dialog.
3. Select the connected machine and **Check server**. Review its platform and server version.
   New connections select and inspect the machine automatically. **Manage workers on this machine**
   opens its coordinator; **Code in this project on this machine** starts a draft on its filesystem.
   Use the project selector or **Browse this machine** to choose the remote directory.
4. Enter a worker name, an existing checkout directory and any placement tags; choose **Register worker
   checkout**. The remote directory is resolved on the target before registration. The coordinator
   stores its server credential through the existing credential store.

Each checkout is an independent execution slot. A desktop-owned loopback forward is suitable for a
local coordinator. A remote coordinator cannot reach that forward on your desktop; use a direct
address it can reach instead. Provider credentials stay on the execution machine. Registering a worker
does not copy your project to it or install its language toolchain.

SSH bootstrap supports Windows, Linux and macOS x64/ARM64; 32-bit Raspberry Pi installations still need a supported 64-bit
OS. Physical Pi/LAN validation is separate from Docker and protocol tests.
For offsite Desktop access through a router VPN, see [remote coding access](remote-access.md#connect-desktop-over-your-lan-or-router-vpn).

## Configure Claude Code or Codex

Open **Executors → Agent setup** for the execution host. **Check installation** detects the CLI version and account
state without making an inference request. Set its executable name or path and choose **Save and
check** if it is outside PATH. Changing an executable requires closing its active harnesses first.

Codex model discovery follows every page returned by app-server and preserves its model names and
recommended default. A discovery failure appears in Agent setup instead of being shown as a complete
empty or partial list. The handshake identifies the running Redcode version.
The model selector provides search and an explicit **Enter a model ID** option for custom overrides.

Redcode drives Claude Code through its CLI and is tested against Claude Code 2.1.327 or later. The
installation check warns when the host has an older release; run `claude update` there.

Claude's installation check lists the models its CLI offers on that host, read from the CLI's startup
handshake without a model request. Hooks and configured MCP servers stay off for that check. Leaving
the model empty keeps Claude's own default. For a Claude subscription, the check also shows how much of
each usage window is used and when it resets, as reported by the CLI. That report is experimental in
Claude Code, so the check omits it when the CLI does not provide it.

**Install with npm on this host** installs the official `@anthropic-ai/claude-code` or `@openai/codex`
package. This explicit action needs Node.js/npm and permission for a global installation on that host.
The CLIs are not bundled into Redcode, and existing installations can be used without downloading them.

For Codex, **Sign in** runs app-server's device-code flow on that machine: the screen displays its
verification link and code. The provider owns token storage. Sign-in can be cancelled and expires
after five minutes.

Claude sign-in stays in Anthropic's own flow. Run `claude auth login` in a terminal on the execution
host (with `CLAUDE_CONFIG_DIR` set when the instance uses its own configuration directory), then choose
**Check installation**. Redcode never opens or relays Claude sign-in. The check shows whether the
instance uses a Claude subscription or an API key. An API key in the host environment takes precedence
over a subscription login, and its usage is billed to that key.

Claude and Codex processes do not inherit the variables of a Claude Code session that launched Redcode,
so a harness never joins that session.

These host-wide APIs require an infrastructure owner administrator or an existing trusted server
connection. Organization membership alone does not grant access to the host's provider accounts or
arbitrary directories. This delivery does not introduce account-profile isolation or tenant-scoped
external harness execution.

## Run and control a harness

In **Executors → Sessions**, choose the coding agent, optional model override and checkout directory, then **Start harness**.
Starting establishes the native protocol; **Send instruction** starts the work. The app shows output,
tool activity and pending requests for that native session. Only an opened run reads its output;
the session inventory contains metadata. The output view displays its most recent 200 events.

On mobile, starting or selecting a run opens its details as the main workspace view. **Review requests**
brings pending questions or approvals into view without scrolling past the output. **Execution controls**
and **Harness output** can be expanded when needed. The header remains outside the scrolling body.

**Back to sessions** returns to the session picker and creation form; **Open session details** reopens the selected run.
Desktop uses **Close** to dismiss the inspector. These navigation actions preserve an unsent instruction
and answers for the same run and never stop its process. Selecting a different run clears those drafts.
Detail polling pauses while the inspector is closed; the host's session inventory continues to refresh.
On wide screens, the inspector sits beside the session workspace. The **Agent setup** tab keeps
installation and account actions separate; changing tabs retains unsaved executable and session fields.

Codex's installation check also fetches the host/account's advertised models. The model field offers
those suggestions. Leaving it empty preserves the CLI's configured default; an unavailable default
is reported by the provider, and you can choose an advertised model without editing a file.

| Adapter     | Transport                        | Active steering            | Queued instructions | Interrupt | Native resume    |
| ----------- | -------------------------------- | -------------------------- | ------------------- | --------- | ---------------- |
| Codex       | app-server JSON-RPC over stdio   | Yes                        | Yes                 | Yes       | Saved thread ID  |
| Claude Code | CLI stream-json/control protocol | Yes, joins the active turn | Yes                 | Yes       | Saved session ID |

The adapters preserve each provider's permission behavior. Supported command/file approvals and
questions appear in the run's panel. Unsupported requests can be declined; the app never fabricates
support or silently approves them. Answers target a still-pending request on the owning process.
Codex events from another thread/active turn are ignored.

A decline can say why, so the agent changes course instead of stopping: Claude Code reads the reason
with the declined call, including a declined plan; Codex's decline carries no text, so Redcode steers the
reason into the turn that continues after it. The reason appears in the output as your input. Without a
reason, Claude Code uses its own wording for a plain rejection: Claude stops and waits for your next
instruction instead of trying another way.

A command or file approval can also be allowed for the rest of the session. The provider then stops
asking for matching calls: Codex through its session approval cache, Claude through the rules Claude Code
suggests for that call, kept to the native session and never written to the checkout's settings. Allowing
for the session never changes the run's permission mode. Plan approvals and questions always ask.

Steering a Claude run sends the instruction into the active turn. Claude reads it with its next step,
including after a pending approval is answered, and the turn still ends once.

An instruction can carry up to 10 PNG, JPEG, GIF or WebP images: paste them, drop them on the
instruction or choose **Attach images**. An instruction may be only images. Redcode reduces an image
larger than 2000 pixels on a side before sending it, as Claude Code would, and keeps each image within
5 MB. Claude Code and Codex receive the images in their own protocols, alongside the text. A queued
instruction keeps its images until it is delivered or cancelled, and the output marks each image
with `[image]`.

Claude output streams as it is written. Claude's reasoning appears as summaries, one block per thinking
step, set apart from its replies. When a run enables delegation, background waits or Computer
Use, Redcode appends a short note to Claude Code's system prompt saying when to load those tools. It
never replaces Claude Code's own system prompt.

A Claude harness can start with a reasoning effort and a permission mode. **Ask before each action** is
the default. **Accept file edits automatically**, **Plan before making changes** and **Auto** follow Claude
Code's own modes. In plan mode, Claude's proposed plan appears as an approval request; approving it
lets Claude start the work, and the run then records that it left plan mode. **Full access** runs every
action without asking, so choose it only for a checkout you trust. Codex harnesses keep their own
settings and reject these options. Claude's tool activity, including its subagents', names the command,
file or query each call acts on. On a subscription, the run also shows a notice when Claude is close to
a usage limit, and an error with the reset time once a limit is reached.

Sending the same instruction ID again uses first-admission-wins behavior. Reusing it in another run
is rejected. Queued input is stored on the host, and interruption cancels queued instructions. After
host restart or process loss, a run normally displays **Needs reconciliation**. A delegation parent
with outstanding work can instead resume automatically as described below. **Resume native session**
reattaches using a recorded native ID; input whose delivery was ambiguous is not resent.

**Fork into a new session** starts a new Claude run from a finished run's conversation. Claude Code copies
the history into a new native session, so the original run is unchanged. The fork keeps the source run's
checkout, model, effort, permission mode, background-wait and delegation settings; Computer Use is not
carried over. Codex runs cannot be forked.

Other unknown executions must be reconciled first: check the original machine and confirm in the screen
that its process has stopped. Redcode does not claim to have killed a process it no longer owns.

**Close owned process** stops only the process tree launched for that run, preserving its native
history and Redcode output. It waits for process closure before releasing the attachment.
The external sessions remain separate from native Redcode Session IDs and the native worker batch
engine. Selecting a remote host runs the adapter there; automatic worker-batch placement still uses
the native Redcode harness. External provider subagent controls and provider-independent rollback
are outside this delivery.

When starting a Codex or Claude harness, **Allow delegation to configured coding agents** enables
Redcode's delegation tools for that run. An agent can start a task in Redcode or in a configured
Codex or Claude harness on the same host and checkout, inspect its output or interrupt it. Codex and
Claude children are separate harness runs and do not automatically enable further delegation.
A Redcode child is a native Session linked to the external parent by task metadata; it uses saved
Redcode model settings and asks for permission for tool actions. Its permission requests appear in
that native Session. External harnesses must already have been explicitly configured in Executors;
Redcode does not install a harness or sign in on the agent's behalf.

Delegation requests are keyed by a caller-supplied request ID. Retrying the same ID for the same
parent retains the original child; another parent cannot access it. Completed outcomes remain
available after a host restart. An admission interrupted by a restart is reported as unknown and is
not automatically replayed. Pending permissions and questions still require attention in the
child's session. Interrupting the parent does not automatically interrupt its child. Completed
results are delivered automatically when the parent is ready; they remain pending while it is
interrupted. A native Session can also delegate to a configured Codex or Claude harness with the
`external_delegate` tool, subject to its normal permission rules. Its result is admitted to the
parent Session as a durable synthetic message.
Codex and Claude execute with their own harness permission settings; they do not inherit individual
file or command restrictions from the native Redcode Session.
For organization-managed servers, native Sessions cannot delegate to host harness accounts until
the initiating user's infrastructure authorization can be preserved with the Session. An
administrator can still open an explicitly configured harness through the existing host controls.
If the host stops while a delegated native Session is running, Redcode reconnects the task to that
Session after the normal restart recovery and delivers its result when the parent is ready. The
original prompt is not sent again. An eligible Codex or Claude parent with outstanding delegated work
is also reattached automatically using its recorded native ID, once the previous recorded process and
host owner have stopped. Pending results then flow into the resumed parent. Redcode waits if the old
process is still running or its identity cannot be verified; a parent explicitly interrupted or closed
by the user is not restarted. Records created before process tracking and ambiguous process starts
still require manual reconciliation. An instruction or result whose delivery became ambiguous is not
resent automatically; inspect it before retrying. An admission that cannot be reconciled remains unknown.
Foreground servers recover only Sessions belonging to outstanding delegations and their descendants;
the managed background service and embedded fetch server also recover other suspended Sessions.

## Create, review, integrate and archive

1. Open **Worktrees**, choose a known project or **Open repository** using its directory on this host.
2. Select the source/integration target, a worktree name and an optional existing branch/ref. Creation
   uses the current strategy and project preparation configuration. The Git strategy creates a
   detached checkout; the app does not invent a new branch.
3. Choose **Start coding agent here** to open Executors with this exact host and checkout preselected.
   **Project environments** opens reusable preparation and validation recipes for that same host and
   worktree. See [project environments](project-environments.md) for service lifecycle and ports.
4. Close the attached harness before modifying its Git state. **Review changes** shows the common-base
   diff, checkout status and both commit IDs. Untracked contents enter the diff after committing.
5. **Commit all non-ignored changes** stages and commits that managed worktree with your supplied
   message. Git identity and commit hooks come from the repository/host. A failed hook is reported.
6. **Integrate reviewed commit** requires clean source and target checkouts and unchanged reviewed
   commit IDs. It uses `git merge --ff-only`. Divergence is reported without a merge/conflict mutation;
   resolve it with a manual merge or rebase before reviewing again. Large previews are truncated and
   the UI disables integration until you can review the full result separately.
7. **Archive worktree** requires a clean managed checkout and explicit confirmation. It creates a
   permanent `refs/redcode/archives/...` reference before removal, preserving detached commits against
   Git garbage collection. Active/recent native sessions or attached external processes can block
   removal. If removal fails, the reference remains as a recovery record.
8. **Archived results → Restore as a new worktree** creates another checkout from the saved reference.

Archive preserves committed, non-ignored content. Ignored files and empty directories are not captured;
move any needed artifacts before confirming removal. Existing worktree safety checks remain in force.
Integration checks repository identity and recorded checkout ownership. This is not cross-host Git
synchronization or coordinated multi-server execution ownership.

### Combine several results

The host API also supports preparing several managed Git worktrees together, even when their histories
diverged. The existing single-worktree action in the UI keeps its fast-forward behavior.

1. Call `worktreeLifecycle.prepareIntegration` (`POST /api/worktree/integration/prepare`) with the
   `projectID`, recorded `target`, reviewed `targetHead`, and an ordered `sources` array of
   `{ directory, head }` entries. Use full commit IDs and between 1 and 32 distinct managed sources
   from the same Git repository. Every selected checkout must be clean.
2. Preparation creates Git objects without changing checkout files, indexes or refs. The response
   records each source as `included`, `fast_forward`, `merged` or `conflicted`. On conflict, it returns
   exact paths and stops before later sources; no complete candidate `head` or `tree` is returned.
   Resolve the conflicting source changes separately, commit them and review the new inputs.
3. A `ready` response identifies the combined `head` and `tree`, plus a bounded diff against the
   reviewed target. This is a merge result, not validation evidence. Use `worktree.create` with
   `branch: candidate.head` to create a managed validation checkout, then run the integration task's
   checks there. Such a checkout also keeps the candidate reachable; preparation alone creates no
   archival reference. The same pinned inputs reconstruct the candidate while their commits remain
   available. The host requires Git 2.38 or newer for `merge-tree --write-tree`.
4. Call `worktreeLifecycle.applyIntegration` (`POST /api/worktree/integration/apply`) with the original
   inputs and `candidateHead`. Application requires idle source and target checkouts, repeats the
   clean/revision checks, reconstructs the candidate and compares its commit ID before fast-forwarding
   the target. A changed input or candidate requires another review and verification. Sources stay in
   place. The operation does not execute checks or accept any Todo task.

These routes use the host's trusted connection and project inventory, like the other checkout
lifecycle operations. They do not fetch remote worker repositories, schedule agents or lock out Git
commands from other processes. The coordinator associates the selected source sessions with its
task reconciliation report and verifies the combined delivery against the shared objective.

For an integration task with accepted prerequisites, use
`POST /api/session/:sessionID/todo/:taskID/integration` with `{ revision, target, targetHead }` to select
those sources automatically. Every prerequisite needs a current successful tracked contribution in a
managed local Git checkout. The host resolves nested session directories to their recorded checkout
roots and deduplicates shared roots while retaining each task's provenance. It saves a complete
candidate with task/session/prompt identities and commit IDs in the existing Todo row and history;
conflicts save no new binding. Retrying the same candidate with the current task revision retains its
original preparation timestamp and revision.

Reconciliation exposes `integration.binding`, `integration.contractCurrent` and its issues. That
freshness applies to task contracts and delegations; applying the candidate still repeats the Git
checks through `worktreeLifecycle.applyIntegration`. Task completion refuses an obsolete binding or
verification older than its preparation. A fresh successful check still needs to cover the combined
criterion: this provenance record is not a validation receipt tied to the candidate SHA.

Protocol references: [Codex app-server](https://developers.openai.com/codex/app-server) and
[Claude Code programmatic execution](https://code.claude.com/docs/en/headless).

## Numeric usage reporting

The host stores a separate numeric projection of usage reported by its installed harnesses. Enable
delivery in **Settings → Usage reporting**; see [usage reporting](clients.md#usage-reporting) for
destinations, permissions, signatures and recovery behavior.

Claude result frames produce an interaction usage record with reported tokens/cache for the main agent
loop. Their `total_cost_usd` and `modelUsage` are cumulative across prior interactions and subagents:
the reporter sends them separately as a `session.summary.updated` snapshot with `pricingBasis: estimated`
and `coverage: session_tree`. Never sum this estimate across results or treat it as a provider invoice.
Codex thread token updates produce cumulative `session.summary.updated` snapshots;
replace earlier snapshots instead of adding them. Its completed interactions also produce status and
duration records with unknown usage, so consumers do not charge the same cumulative tokens twice.
The first cumulative snapshot can include consumption preceding reporter configuration and must be
treated as an initial baseline when calculating later deltas. Missing or reset counters require
reconciliation rather than invented positive consumption.

External harness IDs and provider-native session/thread IDs are separate fields. The reporter does not
invent S1 execution or an upstream provider for an external harness. Unavailable message totals, tool
statistics, reasoning/cache breakdowns and costs remain `null`. Prompt counts reflect admitted host
inputs. No raw protocol frames or text events are forwarded. Numeric records survive host restart and
are acknowledged only after copying into the reporter's durable outbox.
