# Agent tools

Redcode can install and configure Rift, Browser Control, Terminal Control and Computer Use as optional capabilities on an execution host. Desktop, CLI and TUI share the same saved settings on that host. The tools are disabled initially and their packages are downloaded only when you choose **Install managed version**.

| Capability       | What it adds                                                                                    | Supported hosts                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Rift             | Copy-on-write workspaces that preserve the selected source's current files, edits and Git index | macOS x64/ARM64; Linux x64 with a supported filesystem                                        |
| Browser Control  | MCP tools for an existing Chromium browser, including its signed-in sessions                    | Windows, macOS and Linux x64/ARM64; Node.js 22.19 or newer                                    |
| Terminal Control | MCP tools to inspect and interact with persistent terminal sessions                             | macOS and Linux x64/ARM64; Linux requires glibc                                               |
| Computer Use     | MCP tools to inspect and operate applications in the host's desktop session                     | Windows, macOS and Linux x64/ARM64; platform permissions and a graphical session are required |

These tools run on the connected host. If your laptop connects to a remote workstation, Browser Control uses the workstation's browser and Computer Use operates its desktop. A headless worker can run terminal tasks; it does not acquire access to your laptop's screen. Rift snapshots separate working files, while [worker environments](distributed-workers.md#prepare-isolated-workspaces-in-the-app) provide container isolation.

## Configure in Desktop

Open **Settings → Agent tools**. With several servers configured, select the server under **Settings → Servers**, then open **Agent tools**. The page identifies the execution host and its architecture.

Choose a capability and install its managed version. Complete its required setup on that host, run diagnostics, then enable it for agents. **Run diagnostics** checks the installed command without performing browser or desktop actions. Under **Options**, change the execution timeout or provide a custom command as a JSON array. Leave that field empty to use the managed installation.

The page distinguishes **Not installed**, **Installed · Disabled for agents** and **Installed · Enabled for agents**. Installing does not enable a tool. Each supported tool shows the setup required on its execution host; browser approval and operating-system permissions must be completed there and are not verified by the installed or enabled status.

Changes apply to active projects on the selected host. Enabling a control capability registers its MCP connection and an agent workflow; disabling it removes those registrations. The packages remain in the managed cache. Opening settings does not check for updates, install packages or launch diagnostic processes.

Explicit workspace placements with a separate execution environment do not inherit host-cache commands. Configure the worker's own Redcode server to use that worker's tools.

On Console-managed infrastructure, only an infrastructure **owner admin** can configure these capabilities. Organization roles do not grant host administration. Agent control actions ask for permission by default and also follow the agent's configured permission rules. Read-only and internal agents retain their restrictions; Plan does not gain desktop controls.

## Configure in the terminal

In the TUI, open `/agent-tools`. Select a capability and use the listed actions to install, enable, diagnose or edit its command and timeout. The dialog displays the connected host, installation status and browser extension directory.

The CLI provides the same operations:

```sh
redcode tools list
redcode tools install browser-control
redcode tools enable browser-control
redcode tools probe browser-control
redcode tools configure browser-control --timeout 120000
redcode tools disable browser-control
```

For an existing installation, supply its MCP stdio command:

```sh
redcode tools configure terminal-control --command-json '["/usr/local/bin/termctrl", "mcp"]'
redcode tools enable terminal-control
redcode tools configure terminal-control --reset-command
```

Commands are passed as executable arguments, without shell interpolation. Rift expects its CLI command rather than an MCP server. Custom-command diagnostics check that the executable exists; inspect its connection under MCP settings after enabling it.

Pass `--server` to configure a remote host using your existing authenticated connection:

```sh
redcode tools list --server https://workstation.example.test
redcode tools enable terminal-control --server https://workstation.example.test
```

## Connect the browser and desktop

After installing Browser Control, settings displays **Browser extension directory on this host**. On that host, open your Chromium browser's extensions page, enable Developer mode and choose **Load unpacked** with the displayed directory. Approve the extension yourself. Browser Control's relay is local to that host; it is not a cross-machine browser tunnel.

Computer Use needs a signed-in graphical desktop and the platform's accessibility or screen-capture permissions. Complete those permissions on the execution host. A Windows service outside the desktop session cannot operate your signed-in applications. Installing the package does not complete those operating-system steps.

## Create Rift workspaces

Install Rift on a supported host, then explicitly initialize the source directory from **Agent tools** or the CLI:

```sh
redcode tools install rift
redcode tools init rift --directory /home/me/project
redcode tools enable rift
```

For a remote host, `--directory` must be an absolute path on that host:

```sh
redcode tools init rift --server https://workstation.example.test --directory /home/me/project
```

Initialization can convert a btrfs source into a subvolume. It never runs automatically when settings opens. Enabling Rift registers it as the host's worktree strategy; the existing worktree controls then create snapshots from the selected source.

A Rift snapshot preserves the source's current state and cannot choose a different starting ref. Redcode rejects that combination instead of ignoring the ref. Rift repository hooks are disabled; separately configured Redcode project setup commands retain their normal behavior. Remove child snapshots before their parent. **Include caches in Rift snapshots** controls whether regenerable files are copied.

Windows snapshot creation, Linux ARM64 and 32-bit Raspberry Pi hosts are not enabled by this integration. Native copy-on-write operations still require a filesystem supported by Rift; installing its executable alone does not establish filesystem compatibility.

The managed packages are pinned to `rift-snapshot@0.0.13`, `@opencode-ai/browser-control@0.8.4`, Terminal Control's platform package at `1.2.1` and `open-computer-use@1.1.0`. They remain outside the main Redcode binaries.

Upstream references: [Rift](https://github.com/anomalyco/rift), [Browser Control](https://github.com/anomalyco/browser-control), [Terminal Control](https://github.com/anomalyco/terminal-control) and [Computer Use](https://github.com/anomalyco/computer-use).
