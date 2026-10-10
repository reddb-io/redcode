# Distributed Redcode workers

Implemented in source, unreleased. The installed desktop and physical Raspberry Pi hosts have not been validated with this feature.

The desktop's **Agents → Remote workers** panel and `redcode workers` coordinate independent Redcode servers through the authenticated V2 API. Each server owns its own database, sessions, tools, provider configuration and checkout. A registered checkout is one execution slot. Tasks in different slots run concurrently; tasks in the same slot run sequentially.

This is a batch coordinator, not clustered ownership of a shared Session database. Do not share SQLite files between workers. Use one registry on one coordinator for this initial version; another registry or unrelated client is not governed by its checkout reservations.

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

## Permanent coordinator and desktop

Keep the updated agent server running on the machine that will coordinate the pool. Its server-owned worker service runs independently of any desktop/browser connection. In **Agents → Remote workers** on that server, register each machine's address, absolute checkout directory, server password or pairing token, and optional capability tags. **Check connection** verifies authentication and displays the actual platform.

The panel uses the canonical Redcode design-system button, card, input and textarea contracts. Add independent tasks to a batch, choose a worker or allow placement on any available worker, then **Send batch**. The server accepts one unfinished batch at a time, dispatches its tasks across independent checkout slots, and continues observing when the panel closes. Permissions and input requests must be answered in the worker Session using a normal connected client.

The coordinator persists its registry and batch journals under `<Redcode state>/workers`. Each committed batch includes its original registry snapshot for historical patch collection. Worker secrets use the server's existing credential store; registry/API responses contain credential references, never the supplied password. Removing a worker removes its credential and is blocked as soon as a batch is accepted. Credentials follow the existing store's protection; this feature does not add credential encryption or Console organization authorization.

An ownership lease prevents two server processes from operating the same coordinator directory. On Linux, lock metadata also records the boot ID and process start time so a container restart that reuses its PID can recover immediately. After restart, the coordinator observes saved assignments rather than automatically replaying ambiguous prompts. **Recover on the original worker** explicitly retries with the original placement and admission IDs. The lease is local coordination, not clustered execution ownership or failover fencing.

For terminal tasks, **Review changes** collects the recorded turn's file diffs and lets you download its text patch. Collected artifacts are cached on the coordinator and remain reviewable after a worker is removed. Collection never applies a patch to the local project. Initial collection still needs the worker and its credential; collect results before removing that worker.

## Raspberry Pi prerequisites

The Redcode build targets and SSH bootstrap support Linux ARM64. The supplied Pis have 8 GB RAM, but their OS architecture and addresses still need confirmation. On each Pi, run:

```sh
uname -m
getconf LONG_BIT
hostname -I
```

Expected architecture: `aarch64`, `64`. `armv7l` or `32` needs a 64-bit OS before using this build. Native dependencies and real Pi execution still need device acceptance; cross-platform build declarations alone do not prove they work.

Install the new Redcode version once its Linux ARM64 artifact is built. Give each Pi an independent clone/checkout and configure an LLM provider on that Pi. Models can run through external APIs; the Pi executes the tools and commands. Windows-specific tools/builds remain on a Windows worker.

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

| State                                | Meaning                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queued`                             | No worker assignment yet; a matching worker may be offline or all matching slots are occupied.                                                        |
| `dispatching`                        | Placement and IDs are journaled before remote creation/admission.                                                                                     |
| `running`                            | No terminal result yet, including when local observation time expires.                                                                                |
| `waiting`                            | The worker Session needs permission or form input. Answer through its normal client, then observe again.                                              |
| `unknown`                            | Creation, admission or observation could not be confirmed. Inspect the assigned Session; the coordinator never automatically replays or transfers it. |
| `succeeded`, `failed`, `interrupted` | Remote terminal outcome, or a definitive API rejection before admission (`failed`).                                                                   |

An unfinished batch retains the registry across invocations through `<registry>.batch.json`. Checkout reservations last until the corresponding terminal state is observed. Offline/unauthorized workers leave tasks queued. Missing credentials, duplicate task IDs, unmatched capabilities and incompatible journals fail before dispatch. If a saved journal is missing, restore it before dispatching more work; silently recreating it could duplicate already running work.

## Recover ambiguous admission

Ordinary `run` only observes previously assigned Sessions. If creation or prompt admission lost its acknowledgement, recover the affected `unknown` or `dispatching` task explicitly:

```powershell
redcode workers recover linux-tests --config .\workers.json --manifest .\tasks.json --report .\tasks.run.json --timeout 300
```

Recovery retains the original worker, checkout, Session ID and message ID. It creates the Session only after that worker reports it missing, then re-admits the same prompt ID using V2's first-admission-wins contract. The authenticated `POST /api/session/:sessionID/wake` endpoint schedules admitted work without interrupting active execution. Finished Sessions are observed without another prompt. Repeated wakeups coalesce and do not admit new input. Workers need the updated server exposing this endpoint.

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

Next acceptance work: install and exercise the updated desktop; physical Pi ARM64/LAN/SSH execution; checkout synchronization and binary/commit transfer; agent-tool integration; resource scheduling; and explicit failover ownership. Hosted Console gateway, billing and SSO/SCIM remain separate parity work.
