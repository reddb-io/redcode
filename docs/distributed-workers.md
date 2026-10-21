# Distributed Redcode workers

Available in Redcode 0.76.0 and later. CLI and server coordination have Docker acceptance coverage; physical Raspberry Pi ARM64/LAN/SSH execution still needs device validation.

The desktop's **Agents → Remote workers** panel and `redcode workers` coordinate independent Redcode servers through the authenticated V2 API. Each server owns its own database, sessions, tools, provider configuration and checkout. A registered checkout is one execution slot. Tasks in different slots run concurrently; tasks in the same slot run sequentially.

Each worker arbitrates its own checkout reservations, including requests from different coordinators and registries. Workers keep independent databases; do not share SQLite files between hosts. A worker database is the authority for that worker, rather than a shared Session execution cluster.

## Checkout ownership and reconnection

Sending a task first reserves its existing checkout on the worker. The worker records the original
Session and message IDs, a task owner, the coordinator's current runtime identity and an increasing
generation. The reservation is written before creating the Session or admitting its prompt. Two
coordinators asking the same worker for that checkout cannot both acquire it. Paths are resolved on
the worker, so alternate spellings and symlink aliases do not create extra slots.

Coordinator control expires after 60 seconds and is renewed while observing work, normally every
20 seconds. The worker validates the current fence on mutating Session requests, including queued
input, permissions, forms and interruption. Requests already admitted hold the fence until their
handler finishes. A superseded generation cannot control or restart its old assignment, including
through the ordinary Session endpoints. Managed assignments retain their Session and placement;
moving, deleting or forking them through those endpoints is blocked.

Expiration revokes commands; it does not free the checkout or stop an agent that may still be
working. Pending input, suspended execution and active child Sessions retain the reservation.
Release requires confirmation from the worker that no admitted or executing work remains. Only
then may another task acquire the checkout, with a new generation. An ambiguous response retains
the original assignment instead of dispatching it elsewhere.

After a coordinator restart, its new runtime waits for its predecessor's deadline before reclaiming
observation of the original assignment. This changes the fence without replaying a prompt or waking
the agent. Unconfirmed admission or an idle interrupted task still uses **Recover on the original
worker**, or `redcode workers recover`, with the saved registry, manifest and report. Keep those
files: their original IDs are needed for recovery. A permanently abandoned reservation is deliberately
not reassigned to a different task just because its timer expired.

The CLI reports reservation generations and release alongside task state. **Agents → Remote workers**
shows the same state, explains a lost lease and offers recovery in desktop and web. Older workers
without the fencing capability leave new tasks queued with an upgrade explanation. Existing
unfenced assignments can still be observed; their ambiguous prompts are never automatically resent.

These guarantees apply to Redcode's native worker Session controls. They do not sandbox arbitrary
host processes, make tool side effects exactly once or aggregate resource budgets across
coordinators. Use isolated workspaces for OS resource limits and checkout isolation.

## Connecting from the web client

**Agents → Remote workers** registers workers on the selected coordinator. The coordinator connects
to each worker; the browser needs access to the coordinator, and the coordinator needs network access
and credentials for its workers. Each worker is an independent Redcode server.

**Agents → Machines** also lets the browser connect directly to another Redcode server. When the web
page and that server have different origins, allow the web page's origin on the destination server.
For example, if the web client is open at `http://10.0.0.10:4096`, run on the destination machine:

```sh
redcode service set cors http://10.0.0.10:4096
redcode service start
```

This updates the managed service's allowed origins. To retain other configured origins, include them
in the comma-separated value; inspect the current list with `redcode service get cors` first.
For a foreground server, use `redcode serve --hostname 0.0.0.0 --port 4096 --cors http://10.0.0.10:4096`.
Use the origin of the page open in the browser, including its scheme and port, without a path or
trailing slash. Pairing still requires a valid link or credentials. A VPN provides network reachability;
it does not change browser CORS rules. An HTTPS web client also needs an HTTPS destination or an
appropriate tunnel to avoid mixed-content blocking.

## Docker acceptance lab

A permanent Linux coordinator and two isolated Linux workers validate the software path before connecting physical devices:

```powershell
cd packages/cli
bun run test:workers:docker
```

Run with either Docker Desktop's Linux engine or Docker inside WSL. The script builds the pinned Bun 1.4.2 image from this checkout, creates a unique Compose project, selects free loopback ports, and tests both CLI coordination and the permanent server API. Each container has its own SQLite database, Git checkout and volume, with a one-CPU/1-GB limit. No host project or user configuration is mounted. The fixture password is test-only; listeners are published on `127.0.0.1`.

The workers run production HTTP/auth, Session execution, restart recovery, filesystem tools, shell and Git. Only model responses/model resolution use deterministic `TestLLM` fixtures, so the lab needs no external provider credentials or paid calls. Its explicit test configuration allows its fixture shell commands. It is not a production worker deployment or a test of real provider behavior.

The acceptance runner verifies concurrent execution, rejected unauthenticated requests, independent databases, actual file edits and task-turn patch collection. It kills one owned worker with `SIGKILL`, observes the disconnected task without releasing its checkout, restarts the same worker with its persisted database, recovers using the saved IDs, and checks that the user prompt was delivered once and the queued successor completes. It also registers workers through the coordinator API, kills that coordinator while both agents run, and verifies that worker execution continues and the restarted coordinator collects results with the original Session IDs. Durable restart recovery does not guarantee exactly-once external tool side effects.

Reports, patches, system information and logs are saved under `.red/tmp/redcode-workers-<id>` by default. Use `--output <new-directory>` to keep them elsewhere or `--skip-build` to reuse an already built lab image. Containers, the project network and its volumes are removed in `finally`; the image/build cache stays available for reuse. Cleanup is scoped to the generated Compose project, with no Docker-wide prune.

The earlier two-worker lab passed 16 acceptance checks on Docker Desktop Linux `x86_64` and Docker inside WSL. The extended three-container lab passed 29 checks inside WSL, including permanent coordination, credential persistence and cached artifacts after worker removal. These fixtures do not establish Raspberry Pi ARM64/native-dependency, SSH or physical LAN acceptance.

The resource-admission extension passed 35 checks inside WSL. Both workers reported their one-CPU/1-GiB container limits, and over-budget CPU/RAM tasks stayed unassigned. The original execution, restart and collection checks also passed. Reports include host resource snapshots and a constrained-task journal.

## Permanent coordinator and desktop

Keep the updated agent server running on the machine that will coordinate the pool. Its server-owned worker service runs independently of any desktop/browser connection. In **Agents → Remote workers** on that server, register each machine's address, absolute checkout directory, server password or pairing token, and optional capability tags. **Check connection** verifies authentication and displays the actual platform.

The panel uses the canonical Redcode design-system form contracts. Worker setup starts with the name,
address, checkout and credential; **Advanced worker settings** holds capability tags and the Console
resource ID required for organization access. Cancelling clears the credential and returns to
**Add worker**. Connection and batch actions stay accessible while long forms scroll on phones.

The task composer precedes the worker inventory. **Run on** searches locally by worker name, address,
checkout or capability; choose **Any available worker** to leave placement to the coordinator.
Each draft shows its saved worker, required capabilities and declared CPU/RAM budgets, including an
optional CPU usage threshold. Changing the next task's settings does not change drafts already in the
batch. If a draft's explicit worker is no longer registered, the UI keeps that assignment and blocks
sending until the worker returns or the draft is removed. It never replaces that choice with automatic
placement. Drafts remain visible if the registry becomes empty; register a worker before sending.

Add independent tasks to a batch, choose a worker or allow placement on any available worker, then **Send batch**. The server accepts one unfinished batch at a time, dispatches its tasks across independent checkout slots, and continues observing when the panel closes. Open **Agents → Inbox** on the coordinator to answer the assigned worker's permissions and questions. Other forms, including credential entry, use the worker Session's normal connected client. The coordinator resolves each reply from its saved task assignment and rechecks the original request and current resource grants.

Use **Search tasks** and **Task status** to find a task by its prompt, identifiers,
worker, checkout or capability tags. **Execution details** shows the worker
requested by the manifest separately from the worker recorded in the assignment,
along with its checkout, admission budgets, requested model and execution IDs.
The details share the list's instruction, interruption, recovery and review
controls. On mobile they replace the inventory; returning preserves filters and
unsent instructions. A stale report disables controls and offers **Try again**. A
removed task remains unavailable instead of changing the selection. Reports
contain no transition timestamps or execution duration; an absent task entry is
shown as **Not reported**, rather than assumed to be queued.

The **Tasks**, **Workers** and **New batch** tabs separate execution, machine
setup and composition; changing tabs retains unsent drafts and the selected task.
Each batch has a progress indicator covering its entire manifest, including tasks
hidden by filters. Only successful execution counts as completed. Desktop's
**By worker** view groups a single task inventory by recorded assignment, keeping
unassigned work separate; **List** changes its presentation without duplicating
tasks. A requested worker does not establish an assignment. Task rows show their
brief and status; selecting one opens its execution inspector and controls.
Worker reachability and task execution are separate readings; an offline or
removed worker does not move its assigned tasks to another host. Mobile uses the
compact list, and task details replace it. IDs and report metadata are available
in the inspector's disclosures.
Failed refreshes label the overview as the last known report. This view reuses
the existing report reads and does not load conversations or add resource polling.
Completed execution does not imply a patch was collected, reviewed or validated.

**Agents → Hosts and resources** shows available CPU slots and RAM on the coordinator and registered workers. Worker credentials remain on the coordinator. Measurements refresh while the view is open or queued tasks need an admission decision; unknown, unavailable and stale readings are not reported as zero load. On Linux cgroup v2 hosts, visible CPU quotas and memory limits/current usage are considered. Unsupported constrained memory measurements remain unknown. Workers need the updated server endpoints to expose resources and pending requests.

For running/waiting tasks, **Send instruction** uses the worker's native Redcode Session harness: choose **Steer current work** or **Queue for later**. **Interrupt** targets that recorded Session. Controls never accept an arbitrary Session/worker address, recheck current access grants, and refuse completed tasks. Prompt IDs survive a retry of the same instruction, preserving first-admission-wins behavior. These controls do not add external Claude Code/Codex CLI harness adapters.

The coordinator persists its registry and batch journals under `<Redcode state>/workers`. Each committed batch includes its original registry snapshot for historical patch collection. Worker secrets use the server's existing credential store; registry/API responses contain credential references, never the supplied password. Removing a worker removes its credential and is blocked as soon as a batch is accepted. Credentials follow the existing store's protection; this feature does not add credential encryption. Optional Console organization authorization is described in [infrastructure access](console-infrastructure.md).

A local ownership lock prevents two server processes from operating the same coordinator directory.
On Linux, its metadata also records the boot ID and process start time so a container restart that
reuses its PID can reclaim that local lock. The worker-side checkout lease is separate: a new
coordinator runtime must also wait for the previous remote lease deadline before recovering its
saved assignments. Neither mechanism automatically replays ambiguous prompts.

For terminal tasks, **Review changes** collects the recorded turn's file diffs and lets you download its text patch. Review identifies the task and worker, keeps patch download accessible while the diff scrolls, and opens in place of the inventory on phones. **Back** returns to the original task without applying changes or discarding an unsent batch draft. Collected artifacts are cached on the coordinator and remain reviewable after a worker is removed. Collection never applies a patch to the local project. Initial collection still needs the worker and its credential; collect results before removing that worker.

## Prepare isolated workspaces in the app

Open **Agents → Isolated workspaces** and choose the execution host in the sidemenu. This is a host
administration surface: organization roles and worker-task grants do not authorize Docker management.
The host needs a local **Docker 28 or newer Linux engine**. Windows hosts can use Docker Desktop's
Linux engine; remote Linux hosts run their own engine. A remote Docker context is not used in place
of a reachable Redcode host.

1. Choose a published Redcode release and **Build worker image on this host**. The host downloads the
   server archive, verifies its release checksum and builds the image. It includes Bun, Git, curl,
   ripgrep and bash. An administrator-provided toolchain image must retain the managed gateway
   protocol and helper from this image; installing host tools is not part of workspace creation.
2. Enter an environment name, a **public HTTPS Git repository**, and a branch, tag or commit. Set CPU
   and memory limits. Creation resolves the ref to a commit and creates a detached worktree at
   `/workspace/project` in that environment. The image's immutable ID is recorded for restoration.
3. Supply preparation commands if needed, such as `bun install`. They run as the workspace user in
   that checkout. Repository setup scripts are not executed automatically; dependency installers
   may execute their own lifecycle scripts when explicitly invoked.
4. Optionally choose a model provider and supply a key for this workspace. Only that supplied key is
   stored in the worker's private home. Host accounts, Git credentials and project files are not
   copied. Private repositories and provider methods requiring additional configuration are outside
   this first onboarding flow.
5. Inspect the recorded stage and base commit, select the coordinator and **Register isolated
   worker**. Registration on this host uses the worker's internally stored credential. Another
   coordinator uses an authenticated HTTP proxy through the execution host; it must be able to reach
   that host. A desktop-only SSH forward is not a route reachable by a remote coordinator.

For Console delegation, use a **separate Console resource per isolated environment** and grant its
`/workspace/project` checkout to the intended workspace. The coordinator rejects sharing a resource
between different environments. Without a resource, registration remains infrastructure-admin only.
Task dispatch, questions, interruption and patch collection continue through the existing worker
pool. The proxy targets the saved environment and excludes credential and host-management APIs.

Each worker runs with UID/GID 1000, no added capabilities, `no-new-privileges`, a read-only system,
private home/workspace volumes, a 256-process limit and enforced CPU/RAM limits. No host checkout,
host home or Docker socket is mounted. The kernel enforces these quotas even when task admission
budgets are omitted. There is also a separate gateway with **0.25 CPU, 128 MiB and 64 processes**;
include it when sizing a host.

The worker attaches only to its own internal bridge with isolated IPv4/IPv6 gateway modes. Public
outbound traffic uses **HTTPS CONNECT on port 443**, with DNS results checked against private,
loopback, link-local, metadata and reserved ranges before dialing a validated numeric address.
Direct outbound connections and connections to other workspace networks are unavailable. Programs
must honor the supplied HTTP/HTTPS proxy variables. Internal model endpoints, arbitrary TCP/UDP,
SSH Git remotes and browser streaming require separate network adapters. Public HTTPS is not a
destination allowlist; agents can still contact public services permitted by this policy.

Collect results and unregister the slot from its coordinators before stopping or archiving it.
Active native sessions block stopping. **Archive and retain workspace** removes the owned containers
and keeps their volumes and record; **Start or restore** recreates the same environment from its
pinned image and waits for the server. **Delete permanently** requires a separate confirmation and
removes its volumes, history and saved credential. Removal never performs a Docker-wide prune.

Failed or interrupted preparation stays recorded and is not silently repeated. **Prepare another
workspace** creates a draft with a new identity while retaining the original data; review its inputs
and supply commands and credentials again. Completing fleet drain and cross-coordinator ownership
remains separate from these operator-controlled lifecycle actions.

Containers share the host kernel, and volume disk quotas are not yet enforced. This implementation
does not claim virtual machine isolation, tenant-scoped interactive desktop access, hosted fleet
provisioning or complete SaaS readiness. Physical Raspberry Pi and installed desktop acceptance
remain separate from the source app and Docker acceptance.

From `packages/server`, `bun run script/worker-environments-acceptance.ts /path/to/report.json` runs an
optional real Docker lab using an owned temporary host and published server binaries, without LLM
inference. It creates two public-repository environments and verifies containment, quotas, network
restrictions, coordinator registration, HTTP forwarding and archive/restore. Cleanup targets only
the lab's owned containers, volumes and networks; the built image remains cached.

## Raspberry Pi prerequisites

The Redcode build targets and SSH bootstrap support Linux ARM64. Confirm the OS architecture and address on each Pi:

```sh
uname -m
getconf LONG_BIT
hostname -I
```

Expected architecture: `aarch64`, `64`. `armv7l` or `32` needs a 64-bit OS before using this build. Native dependencies and real Pi execution still need device acceptance; cross-platform build declarations alone do not prove they work.

Install the Linux ARM64 server archive from the release. Give each Pi an independent clone/checkout and configure an LLM provider on that Pi. Models can run through external APIs; the Pi executes the tools and commands. Windows-specific tools/builds remain on a Windows worker.

For an explicitly configured LAN worker, its foreground server command is:

```sh
export REDCODE_PASSWORD='your-worker-server-password'
redcode serve --hostname 0.0.0.0 --port 4096
```

The password belongs to the agent server. A Console account password/key does not authorize this server. Existing SSH forwarding can keep the listener on loopback instead: forward each Pi's port to a different coordinator-local port and register those forwarded origins. These instructions do not install, expose or restart any existing server automatically.

## Register and inspect

On the coordinator, store each server password or redeemed pairing token in the named environment variable. Credentials are not saved in the worker registry or batch journal.

```powershell
$env:PI_A_PASSWORD = 'your-worker-server-password'
redcode workers add pi-a --config .\workers.json --url http://192.168.1.50:4096 --directory /home/pi/project --password-env PI_A_PASSWORD --tag linux --tag arm64
redcode workers list --config .\workers.json
```

The address above is an example, not a discovered device. `list` reports connection status and actual server system information. Tags are declared capabilities used for placement; they are not automatic detection of installed tools or available RAM. Add other workers with their own server origin, checkout and credential variable.

Registry format:

```json
{
  "workers": [
    {
      "id": "pi-a",
      "url": "http://192.168.1.50:4096",
      "passwordEnv": "PI_A_PASSWORD",
      "directories": ["/home/pi/project"],
      "tags": ["linux", "arm64"]
    }
  ]
}
```

To increase a worker's capacity, register additional independent checkout directories in its `directories` array. A duplicate server/directory slot is rejected. Do not increase capacity by repeating the same path or aliases of it. Registry edits are blocked while its batch is unfinished.

## Dispatch a batch

### Resource-aware admission

In the desktop, enable **Set resource requirements** and set CPU slots, a RAM budget in GiB, and an optional maximum measured CPU usage. **Required worker capabilities** adds comma-separated tags. The CLI accepts the same requirements through the task manifest:

```json
{
  "tasks": [
    {
      "id": "pi-tests",
      "prompt": "Run the ARM64 test suite.",
      "tags": ["arm64"],
      "resources": { "cpu": 1, "memoryBytes": 1073741824, "maxCpuUtilization": 0.8 }
    }
  ]
}
```

Requirements are optional; tasks without them keep their existing checkout/tag placement behavior. Constrained tasks need a fresh resource sample. The first CPU usage sample is unknown, so a task with a usage threshold may wait for the next sample. Samples older than 30 seconds, unavailable endpoints and unknown required measurements keep tasks queued rather than creating a Session. A smaller eligible task can proceed while another task is blocked.

Declared CPU/RAM budgets of unfinished assignments are deducted before another constrained task is admitted. They are shared across registrations using the same normalized server origin, reconstructed from the saved manifest/journal after restart, and retained for ambiguous `unknown` assignments. RAM accounting is conservative: declared budgets are deducted from reported available RAM even when some of that memory is already in use. Only declared budgets are counted; legacy tasks and external workloads have no known reservation. This is one coordinator's admission policy, not an OS quota, cross-coordinator reservation, full physical-host identity discovery or failover fencing. URL aliases pointing to the same physical machine require operator care.

CPU slots represent available parallelism; fractional visible CPU quotas are rounded up to a slot. They do not represent exclusive physical cores or a guaranteed amount of CPU time.

The permanent coordinator retries queued tasks automatically. A foreground CLI run can report queued work and exits `1` while any task has not succeeded; rerun the unchanged manifest/report to retry after capacity becomes available. `queueReason` distinguishes busy checkouts, unavailable/stale metrics, CPU count/load and insufficient RAM. Metrics account for visible [cgroup v2 CPU and memory controls](https://docs.kernel.org/admin-guide/cgroup-v2.html); inaccessible or unsupported limits can still prevent admission.

If a requirement cannot be satisfied, use **Cancel queued task** or the CLI command below. Cancellation is restricted to a saved queued task with no assigned Session, validates the original manifest/registry journal, and records `interrupted` with `Cancelled before assignment`. It does not send a request to a worker. Once every task is terminal, the registry is released for changes/new batches. Running, waiting or ambiguous assignments cannot be discarded through this command; use their native harness control or original-worker recovery instead.

```powershell
redcode workers cancel pi-tests --config .\workers.json --manifest .\tasks.json --report .\tasks.run.json
```

### Task manifest

Create a task manifest. Tasks are independent agent prompts; this version does not split a large prompt into subtasks automatically. Optional `worker` pins placement; every requested tag must match. Optional `agent` and `model: { "providerID": "...", "id": "..." }` select the worker's agent/model.

```json
{
  "tasks": [
    { "id": "linux-tests", "prompt": "Run the Linux test suite and report failures.", "tags": ["linux"] },
    { "id": "review", "prompt": "Review the checkout for regressions and report findings.", "worker": "pi-a" }
  ]
}
```

```powershell
redcode workers run .\tasks.json --config .\workers.json --report .\tasks.run.json --timeout 300
```

The report is an atomic persistent journal containing task states, assigned worker origin and checkout, Session/message IDs, and assistant text from up to the latest 100 messages. Results stay on the worker until explicitly collected below. Prompts may ask agents to edit files under their normal permission rules; the coordinator does not auto-approve permissions.

Run the same command again with the same manifest, registry and report to observe unfinished Sessions. Completed tasks are not sent again. A fingerprint rejects changed manifests/registries under an existing journal. Use a new report for a new batch after the previous batch finishes.

States:

| State                                | Meaning                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `queued`                             | No worker assignment yet. `queueReason` explains offline workers, busy checkouts or unsatisfied resource requirements.                                       |
| `dispatching`                        | Placement and IDs are journaled before remote creation/admission.                                                                                            |
| `running`                            | The original input is confirmed and the worker reports live execution, including when local observation time expires.                                        |
| `waiting`                            | The worker Session needs permission or form input. Answer permissions/questions in the coordinator Inbox, or other forms through the worker's normal client. |
| `unknown`                            | Creation, admission or observation could not be confirmed. Inspect the assigned Session; the coordinator never automatically replays or transfers it.        |
| `succeeded`, `failed`, `interrupted` | Remote terminal outcome, or a definitive API rejection before admission (`failed`).                                                                          |

An unfinished batch retains the registry across invocations through `<registry>.batch.json`. Checkout reservations last until the corresponding terminal state is observed. Offline/unauthorized workers leave tasks queued. Missing credentials, duplicate task IDs, unmatched capabilities and incompatible journals fail before dispatch. If a saved journal is missing, restore it before dispatching more work; silently recreating it could duplicate already running work.

Current workers report the original message receipt, checkout, execution state and whether input is
waiting through one observation request. The receipt and durable execution fields come from one
database snapshot; delivery cannot disappear between a pending-input read and a visible-message read.
This response contains metadata, without prompts or response content. Older workers use their existing
inbox, message and activity APIs for compatible confirmation.

An existing Session alone does not confirm a task. A task remains reserved if its input is missing,
accepted but idle, suspended, or its connection cannot be observed. A terminal result releases the
checkout only after the original input was delivered, execution is idle and the inbox is empty.
**Agents → Remote workers** explains the recovery reason beside the task and offers **Recover on
the original worker**. Repeated checks do not re-admit the prompt, create a replacement Session or
rewrite an unchanged journal. The CLI reports the same states and reasons.

## Recover ambiguous admission

Ordinary `run` only observes previously assigned Sessions. If creation or prompt admission lost its acknowledgement, recover the affected `unknown` or `dispatching` task explicitly:

```powershell
redcode workers recover linux-tests --config .\workers.json --manifest .\tasks.json --report .\tasks.run.json --timeout 300
```

Recovery retains the original worker, checkout, Session ID and message ID. It creates the Session only after that worker reports it missing, then re-admits the same prompt ID using V2's first-admission-wins contract. The authenticated `POST /api/session/:sessionID/wake` endpoint schedules admitted work without interrupting active execution. A finished original admission is observed without another prompt. A Session moved to another checkout must be restored to its original location before recovery. Repeated wakeups coalesce and do not admit new input. Workers need the updated server exposing this endpoint.

An unreachable worker remains `unknown` and retains its checkout. Recovery does not move ambiguous work to another machine, restart intentionally interrupted/failed tasks, or approve permissions. After recovery, the coordinator observes the batch and dispatches eligible queued tasks. Automated failover requires a separate ownership/fencing design; local recovery markers are not clustered ownership or an exactly-once guarantee.

## Collect results for review

```powershell
redcode workers collect linux-tests --config .\workers.json --manifest .\tasks.json --report .\tasks.run.json --output .\worker-results\linux-tests
```

Collection requires a terminal journal entry and an idle remote Session with a terminal outcome. It exports:

- `changes.patch`: text patches from the recorded task turn, addressed by its original user message ID.
- `result.json`: task/worker/Session IDs, actual Session location, outcome, collection time, file diffs and patch SHA-256.
- `response.txt`: assistant text saved in the batch journal.

The actual Session location may be a worktree prepared by the agent. Collection uses recorded turn snapshots rather than the checkout's current diff, so later unrelated edits are excluded. Remote filenames remain JSON/patch data; they are not interpreted as destination paths. The output must be a new directory, and existing outputs are never overwritten. Collection does not apply changes, synchronize checkouts, export commits, or transfer binary contents. A terminal API rejection before prompt admission may have no recorded turn to collect. A non-Git checkout produces no snapshot patch.

## OpenCode reference and parity

The current observed V2 head is `4b6fea2875e4f2e3e8a8fee181803e54f7056845`; the previous imported baseline remains `f714e5f68b0013f92ce5b8d587b0ae3dff0828d5`. This audit does not merge the entire newer V2 head.

- [V2 Session spec](https://github.com/anomalyco/opencode/blob/4b6fea2875e4f2e3e8a8fee181803e54f7056845/specs/v2/session.md) and `packages/core/src/session/execution.ts` explicitly keep execution process-local until a placement/fencing protocol exists.
- [Remote workspace execution plan](https://github.com/anomalyco/opencode/blob/650d5a5e92deb3ff269b3e7051dc1c6b43e9c6ec/specs/v2/remote-workspace-execution.md) places tools/files in hosted environments while retaining the central Session runner. It excludes clustered Session execution and remains an implementation plan.
- `ssh-single-connection` changes SSH bootstrap/transport; `workerd` and `published-workerd` concern Cloudflare hosting, not a Raspberry Pi task scheduler.
- `jlongster/workspace-v2` is an older workspace experiment, behind current V2. Its branch-specific diff is recorded rather than blindly merged.

`docs/opencode-upstream-branches.json` records all 2,032 observed public branch heads and five scoped remote/workspace branch comparisons. It explicitly marks the remaining branches/features unreviewed. Branch names alone do not establish feature completeness. `docs/opencode-parity-ledger.json` continues to mark full parity false.

Next acceptance work: install and exercise the updated desktop; physical Pi ARM64/LAN/SSH execution;
private Git authentication and transfer of local uncommitted work; external-harness placement;
distributed scheduling and explicit failover ownership. Public Git workspace preparation and kernel
resource limits have separate acceptance above. Hosted Console gateway, billing and SCIM remain
separate work; configurable OIDC federation is described in [Console authentication](console-federation.md).
