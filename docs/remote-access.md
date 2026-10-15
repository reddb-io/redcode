# Remote coding access

Remote access connects a client to an **agent server**. Sessions, tools, provider connections and
project files remain on that server's machine. Console is a separate administration listener;
opening Console does not connect a coding client to a project.

## Connect Desktop over your LAN or router VPN

The computer running Desktop can be your control device while a stronger machine runs the agent
server and coordinates other workers. Connect your router VPN before opening the saved server;
the VPN must route the execution host's address and permit SSH. A router VPN does not require
publishing Redcode's coding port to the internet.

1. Open **Agents → Machines** and **Add server → Add SSH server** in Desktop. Enter the execution
   host or SSH alias, such as `user@10.0.0.50`, and an optional display name.
2. Complete SSH authentication and host-key verification in the dialog. Desktop checks the remote
   service, stages the matching server when needed, starts it and manages a loopback SSH forward.
   An existing incompatible service requires **Update and reconnect** before replacement.
   Bootstrap supports 64-bit Windows, Linux and macOS on x64/ARM64; the host must already have SSH.
3. The connected machine is selected and inspected automatically. Choose a known project or
   **Browse this machine**, then **Code in this project on this machine** to execute there.
4. Choose **Manage workers on this machine** to make it the active coordinator. Add its other
   workers using addresses reachable from that coordinator, then send batches through **Remote
   workers**. A normal coding session runs directly on the selected server; batch tasks execute on
   registered worker checkouts, including its own checkout if explicitly registered.

For example, a laptop can connect through the VPN to a workstation that dispatches to additional
LAN workers. Only the laptop-to-workstation connection depends on the laptop's tunnel. Worker
connections must be reachable from the workstation itself; a forward on the laptop cannot serve
as a workstation-to-worker route. **Register worker checkout** remains available when you instead
want to delegate from the currently selected coordinator to the newly connected machine.
The coordinator does not yet manage its own SSH tunnels to workers. Register worker addresses
that it can reach directly, or separately managed forwards on the coordinator's machine.

Keep Desktop running while its SSH forward is in use. Saved connections reconnect when Desktop
opens; SSH authentication can still require interaction. Closing Desktop does not stop the remote
service or erase sessions. Repositories and worker patches are not automatically synchronized.

The agent service releases unused project and workspace runtimes after five minutes of inactivity,
checked once a minute. Their watchers, indexes and local MCP connections close with the runtime;
session history remains stored. Running executions retain their existing inactivity budget, and
pending questions, permissions, interactive terminals and background shell jobs keep their runtime
alive. Opening the project again rebuilds its runtime as needed.

Use `redcode debug memory --json` on the execution host to inspect memory without starting or
replacing the managed service. The `process` section describes the diagnostic command itself;
`service` describes the agent server, including its version, resident memory, runtime heap and
cached project/workspace count when supported. Resident memory can remain above the live heap
after cached objects are released, so compare successive samples rather than interpreting one
resident-memory number as proof of a leak.

Desktop windows share one SSH connection attempt per machine. Automatic recovery uses increasing
delays and pauses after five repeated failures; use **Connect** on that machine to try again.
A tunnel that stays healthy for a minute restores the automatic retry budget.

## Install the web app on a phone

Open your Redcode server in your phone's browser, then go to **Settings → Preferences → Install Redcode**.
When supported, **Install app** opens the browser's installation dialog. You can also use Chrome or Edge's
**Install app** / **Add to Home Screen** menu. On iPhone or iPad, use **Share → Add to Home Screen** in Safari.
Launch Redcode from the home-screen icon to use its own window without the browser address bar.

Use an HTTPS address with a certificate the phone trusts, such as the HTTPS URL from your configured
pairing tunnel or reverse proxy. Access through a VPN still needs HTTPS: `http://10.x.x.x:4096` can open
the web interface but does not meet browser PWA installation requirements. Settings explains this when
the current connection is insecure.

Narrow screens automatically use the design system's `tiny` spacing and smaller reading text. Touch
targets and editable text retain the design system's mobile minimums. The installed app restores its
last session; running agents and loading server data still require a connection to the server.

## Pair a browser with the managed service

On the machine that owns the projects:

```sh
redcode pair --remote
```

On first use, choose **Your own relay** and enter its OpenTunnel-compatible API address, or explicitly
choose **Hosted OpenTunnel** to use `opentunnel.xyz`. Redcode saves that choice; future `redcode pair`
commands use the enabled remote connection and print expiring, one-time links.

For a known self-hosted endpoint:

```sh
redcode pair --remote --relay https://relay.example.org
```

Headless first-time setup also requires `--yes`. This accepts internet exposure; it does not choose
a provider. There is no implicit hosted-provider selection for new headless installations. Switching
relays prepares the new identity before replacing the current service connection, so a provisioning
failure preserves its old configuration. Identities live under Redcode's data directory in separate
profiles per relay. Existing hosted connections retain their address when upgraded.

This enables the managed service's HTTPS tunnel.
Enabling the tunnel can restart that service. Open a link on your other device, then select the
project on the host. Pairing credentials give trusted access to that host; they are not scoped
organization-user credentials.

On first use, Redcode asks you to accept internet exposure before enabling the tunnel.
For a non-interactive setup, explicitly select and accept with
`redcode pair --remote --relay https://relay.example.org --yes`.
Acceptance is remembered; declining leaves remote access disabled and local pairing available.

On phones, the header's **Navigation** menu provides app destinations and settings. **Toggle sidebar**
opens the project/session or agent sidemenu over the page; close it to use the full width for coding.

## Operate your own relay

OpenTunnel is MIT-licensed software with a self-hostable Rust server; using its SDK does not require
an OpenCode account or OpenCode's hosted coding service. The relay API address is configured by the
operator. Redcode supplies the client-side integration, not an already deployed relay service.

The upstream server needs its own public domain and wildcard DNS, a public TCP/TLS listener, MySQL
storage, and certificate issuance. Its current production DNS-01 adapter uses Cloudflare; the local
test CA is for development only. Deploy its supplied Docker image build on your own infrastructure.
For Kubernetes, route the tunnel listener through a TCP load balancer or TLS passthrough rather than
terminating tunnel TLS at a normal HTTP ingress. The client terminates that TLS connection locally.
Configure the server's domain, certificate/DNS credentials and database for your installation; do not
keep the upstream hosted defaults. [Server deployment documentation](https://github.com/anomalyco/opentunnel/blob/master/docs/server.md).

Pairing authorizes access to the coding host. It is separate from worker enrollment, organization
membership and Console grants. External Cloudflare/WireGuard connections can provide a reachable
address, but their installation and management are not yet part of this relay selection.

## Pair through an existing endpoint

For an HTTPS endpoint you already operate, use:

```sh
redcode pair --url https://agent.example.org
```

The URL changes the generated link's address. It does not create a reverse proxy, open a firewall,
or start a server at that address. Route that endpoint to the same managed agent service first.
`--remote` and `--url` cannot be combined.

## Keep the server on loopback and forward it through SSH

On the host, start the managed service if needed and generate a link. If a remote relay is already
enabled, run `redcode service set remote false` first so pairing uses the local address.

```sh
redcode service start
redcode service status
redcode pair
```

On your client machine, forward its port (35555 is the normal managed-service port):

```sh
ssh -N -L 35555:127.0.0.1:35555 user@agent-host
```

Keep SSH running and open the printed `http://127.0.0.1:35555/auth/connect/...` link in the client
machine's browser. If your host uses another port, forward that port. If local port 35555 is busy,
use another local port and substitute it in the browser link, preserving the one-time code.

This recipe uses the existing service. A foreground worker server can be forwarded similarly:
start `redcode serve --hostname 127.0.0.1 --port 4096` on the worker and forward port 4096. That
server uses its configured password; `redcode pair` targets the managed service, not an arbitrary
foreground server.

## Connect a CLI to a foreground server

On the remote host, configure a provider and start the server in the checkout:

```sh
cd /home/worker/project
export REDCODE_PASSWORD='replace-with-a-private-server-password'
redcode serve --hostname 127.0.0.1 --port 4096
```

Forward that port using SSH as above. On a PowerShell client:

```powershell
$env:REDCODE_PASSWORD = 'replace-with-the-same-server-password'
redcode --server http://127.0.0.1:4096
```

The forwarded URL is reachable from that client. Use the remote server's password, not your Console
account's password. The TUI tries its current directory on the server, then falls back to the server's
default location if that lookup fails. Start the foreground server in the intended remote checkout.
The TUI's positional directory argument changes the client's local working directory; do not pass a
Linux-only path there from Windows. An explicit `--server` connection does not replace the remote
service on a client/server version mismatch; install compatible versions.

Desktop also connects to agent servers; select the intended server before opening a project or
managing its remote-worker pool. Browser and CLI connections do not synchronize repositories,
copy credentials, or merge worker changes into your local checkout.

## Distinguish remote access from delegated tasks

- **Trusted operator:** a server password or pairing credential provides broad host administration
  and coding access.
- **Organization or infrastructure user:** a Console session plus resource/workspace grants permits
  scoped worker-batch operations when the coordinator has Console access configuration.
- **Remote worker:** an independent agent server registered with a coordinator. Each checkout is an
  execution slot; task results are collected for review.

See [infrastructure access](console-infrastructure.md) for the delegation setup and current limits,
and [distributed workers](distributed-workers.md) for registration, task manifests, restart recovery
and patches. Scoped batch access does not yet implement tenant-isolated interactive terminals.
