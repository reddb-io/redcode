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

**Install with npm on this host** installs the official `@anthropic-ai/claude-code` or `@openai/codex`
package. This explicit action needs Node.js/npm and permission for a global installation on that host.
The CLIs are not bundled into Redcode, and existing installations can be used without downloading them.

**Sign in** runs the provider's own authentication flow on that machine. Codex uses app-server's
device-code flow: the screen displays its verification link and code. Claude displays its browser
authorization link; if the provider asks for an authorization code, paste it into the masked field
and submit. Codes are passed to the live login process and are not stored in Redcode history.
The provider owns token storage. Sign-in can be cancelled and expires after five minutes.

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

| Adapter     | Transport                        | Active steering             | Queued instructions | Interrupt | Native resume    |
| ----------- | -------------------------------- | --------------------------- | ------------------- | --------- | ---------------- |
| Codex       | app-server JSON-RPC over stdio   | Yes                         | Yes                 | Yes       | Saved thread ID  |
| Claude Code | CLI stream-json/control protocol | Unavailable in this adapter | Yes                 | Yes       | Saved session ID |

The adapters preserve each provider's permission behavior. Supported command/file approvals and
questions appear in the run's panel. Unsupported requests can be declined; the app never fabricates
support or silently approves them. Answers target a still-pending request on the owning process.
Codex events from another thread/active turn are ignored.

Sending the same instruction ID again uses first-admission-wins behavior. Reusing it in another run
is rejected. Queued input is stored on the host, and interruption cancels queued instructions. After
host restart or process loss, the run displays **Needs reconciliation**; it is not automatically
replayed. **Resume native session** reattaches using a recorded native ID; input whose delivery was
ambiguous is not resent. Check the result before asking the agent to continue.

An unknown execution must be reconciled first: check the original machine and confirm in the screen
that its process has stopped. The server refuses resume/release until that operator confirmation.
Redcode does not claim to have killed a process it no longer owns.

**Close owned process** stops only the process tree launched for that run, preserving its native
history and Redcode output. It waits for process closure before releasing the attachment.
The external sessions remain separate from native Redcode Session IDs and the native worker batch
engine. Selecting a remote host runs the adapter there; automatic worker-batch placement still uses
the native Redcode harness. External provider subagent controls and provider-independent rollback
are outside this delivery.

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
