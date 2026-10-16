# Project environments

A project environment recipe records the commands that prepare and validate a development setup.
The recipe belongs to the project; each worktree has a separate execution record and Docker Compose
project name. Opening another worktree reuses the recipe without changing its execution directory.
The Desktop, web app, TUI and CLI call the same API on the selected Redcode execution host.

## Configure in the app

1. Open **Agents → Project environments** and select the execution host in the sidemenu.
2. Enter the project's or worktree's directory **on that host** and choose **Open environments**.
   Known project directories appear as suggestions. For a linked worktree, enter that worktree's path.
3. Give the recipe an ID and a name. Select **Docker Compose** or **Project commands**.
4. For Compose, choose an existing Compose file relative to this worktree. Redcode assigns a separate
   Compose project name for every recipe/worktree pair. It runs `config --quiet` before lifecycle
   operations and `up --detach --wait` when starting services.
5. Supply an optional preparation command and a required validation command. Project-command recipes
   also require explicit start and stop commands. Set the timeout for each command.
6. Bind any required secrets as `VARIABLE=vault-name`. Only the reference is saved. It resolves from
   this execution host's project Vault; Redcode does not transfer a local secret to a remote host.
7. Choose **Save recipe**, then review and confirm an operation. Saving does not execute commands.

**Prepare** runs preparation. **Start** prepares a new/stopped environment when needed, starts services
and runs validation. An already prepared or validated instance of this recipe revision skips that
preparation step. **Validate** reruns the configured check. **Stop** stops this stack.
**Recreate services** stops it, reruns preparation, starts
it and validates again. Compose stop retains containers and their volume associations; recreation
replaces the containers while reusing their volumes. Neither operation prunes Docker. Stop uses the
recorded Compose project label and remains available if its Compose file or Vault binding is missing.

A successful check records the recipe revision and time. This is evidence that the check passed,
not continuous monitoring or a guarantee that every worktree/commit has the same dependencies.
The app refreshes operation state only while work is in progress. The TUI offers explicit refresh.
Commands use PowerShell on Windows and `sh` on Linux/macOS; scripts must support the selected host.

## Ports and multiple projects

Compose project names separate containers, networks and ordinary project-scoped volumes. They do
not make a fixed host port available to several stacks. To run two projects with container port 3001
at the same time, let Docker choose different loopback host ports:

```yaml
services:
  app:
    image: your-development-image
    ports:
      - "127.0.0.1::3001"
```

If a project requires fixed host ports, stop its managed environment before starting another that
needs those ports. Redcode reports a failed start instead of stopping an unrelated application.
Use Compose health checks and a validation script that exercises the application, database and
required APIs. The [Compose wait option](https://docs.docker.com/reference/cli/docker/compose/up/)
waits for running/healthy services; your validation command proves the additional project checks.

Command recipes can wrap existing Makefiles or scripts. Start/stop scripts must finish after
managing their services; a foreground dev server that never returns reaches the command timeout.
`REDCODE_ENVIRONMENT_ID` and `REDCODE_WORKTREE` are supplied to help scripts name and target owned
resources. Redcode cannot identify or undo arbitrary external side effects created by those scripts.

## CLI and TUI

In the TUI, use **/environments**. Select a recipe to choose an operation, create or edit a recipe
through the dialogs, and refresh to inspect completion. Opening the dialog uses the active worktree.
The directory action can inspect another directory on that same execution host.

The CLI accepts the same recipes without requiring a configuration file:

```sh
redcode environments save dev --name "Development" \
  --compose-file compose.yaml --prepare "npm ci" --validate "npm run env:check"
redcode environments list
redcode environments run dev start --revision 1 --yes
redcode environments run dev stop --revision 1 --yes
```

Use `--directory` for the execution worktree and `--server` for an already reachable remote host.
The directory is interpreted on that host. Existing pairing, SSH forwarding, LAN and VPN connections
remain the transport; this feature does not provision a tunnel or expose application ports.
Use `--secret API_TOKEN=project-api-token` when saving a Vault binding. Updating a recipe requires
its current `--revision`. Stop existing environments before editing their recipe; reconcile
interrupted operations first.

The CLI prints a request ID before dispatch. Reusing it with the same action/target returns the
recorded result instead of running the commands again. A different operation needs a new request ID.
The CLI waits for completion; disconnecting the CLI does not cancel an admitted host operation.

## Recovery and access

Only infrastructure administrators or an existing trusted host connection can use these APIs.
Organization membership alone does not authorize host commands. Concurrent operations on the same
recipe/worktree are serialized across server runtimes using that host's environment store.

If the owning runtime disappears during an operation, the environment requires reconciliation.
Inspect the original commands and confirm they have stopped before choosing **Reconcile**. No
commands are replayed. Compose reconciliation records its container inventory without deleting data;
the state becomes **Reconciled**, without claiming the services stopped. Start, validate or stop the
stack explicitly afterwards. In the CLI this requires both `--yes` and
`--confirm-reconciled`.

These are trusted development stacks running with the selected host user's permissions. A Compose
file or lifecycle script can use that user's files and tools. Tenant isolation continues through
[isolated worker workspaces](distributed-workers.md#prepare-isolated-workspaces-in-the-app), which
do not gain access to this host-management API. Automatic learning from conversations, automatic
worker-dispatch preparation and transferring recipes/secrets between hosts are separate work.

For the optional real Docker/HTTP/CLI lab, run from `packages/server`:

```sh
bun run script/project-environments-acceptance.ts /path/to/report.json
```

It uses an already available `oven/bun:1.4.2-debian` image, starts two five-service stacks in temporary
linked worktrees, validates HTTP responses, stops one without affecting the other and recreates
services while preserving volume data. Cleanup removes only its owned stacks and lab volumes.
