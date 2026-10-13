# Remote coding access

Remote access connects a client to an **agent server**. Sessions, tools, provider connections and
project files remain on that server's machine. Console is a separate administration listener;
opening Console does not connect a coding client to a project.

## Pair a browser with the managed service

On the machine that owns the projects:

```sh
redcode pair --remote
```

This enables the managed service's HTTPS tunnel and prints expiring, one-time connection links.
Enabling the tunnel can restart that service. Open a link on your other device, then select the
project on the host. Pairing credentials give trusted access to that host; they are not scoped
organization-user credentials.

On first use, Redcode asks you to accept internet exposure before enabling the tunnel.
For a non-interactive setup, explicitly accept with `redcode pair --remote --yes`.
Acceptance is remembered; declining leaves remote access disabled and local pairing available.

For an HTTPS endpoint you already operate, use:

```sh
redcode pair --url https://agent.example.org
```

The URL changes the generated link's address. It does not create a reverse proxy, open a firewall,
or start a server at that address. Route that endpoint to the same managed agent service first.
`--remote` and `--url` cannot be combined.

## Keep the server on loopback and forward it through SSH

On the host, start the managed service if needed and generate a link:

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
