# Installation

Choose the distribution for the machine's role:

| Installation | Included | Best fit |
| --- | --- | --- |
| `npm install -g @reddb-io/redcode` | CLI/TUI, agent server, Console, embedded Design and RPC sidecar; no Desktop. | Terminal users and server hosts with npm |
| `mise use -g github:reddb-io/redcode@latest` | Full native distribution, including Desktop where supported. | Workstation installation without Node |
| Full native release archive | Same full distribution; Desktop under `desktop/` beside `redcode`. | Manual workstation installation |
| `redcode-server-<target>` release archive | Same CLI/agent engine, Console, Design and sidecar, without Electron. | Coordinators, remote workers and headless hosts |

Download archives from [Releases](https://github.com/reddb-io/redcode/releases). Windows uses ZIP;
Linux and macOS use `tar.gz`. Verify them against the release's `SHA256SUMS` and keep one installation
method per machine. Desktop is included on Windows, macOS and Linux glibc; Linux musl archives omit it.

On x64, npm selects one compatible baseline binary. Linux packages declare glibc or musl;
optimized x64 variants remain available in release archives. Linux ARM64 is a build target;
32-bit ARM/Raspberry Pi OS is unsupported. Physical Pi execution still needs device acceptance.
Design shares Redcode's native executable, so there is no separate native Design package to install.

On Windows, run `redcode desktop` from a full native installation to install Desktop for the current
user under `%LOCALAPPDATA%\Programs\Redcode`, without administrator privileges. The command copies
Desktop, its CLI and RPC sidecar, creates a Start Menu shortcut and registers **Redcode** in
**Settings → Apps → Installed apps**. The app then works independently of the extracted ZIP.
Run the command from a newer full distribution to update it; `redcode desktop --refresh` installs
or repairs the Windows registration without opening the app. Running versions stay available until
they close and a subsequent refresh can remove their files.

Uninstall Desktop through Windows Settings. This closes processes from that Desktop installation
and removes its application files, shortcut and owned protocol registration. Projects, sessions,
credentials and settings are preserved. A separate npm or mise installation is managed by its own
package manager. `redcode desktop --path` only prints the current distribution's app path;
an explicit `REDCODE_DESKTOP_APP` continues to open that app without installing a copy.

On Windows, npm's installation script makes the CMD, PowerShell and Git Bash launchers call the
native executable directly, without keeping a Node.js launcher running. Allow installation scripts
when installing with npm; installations made with `--ignore-scripts` retain the JavaScript launcher.

In the terminal UI, paste text or screenshots with Ctrl+V. If the terminal consumes that shortcut,
use Alt+V; Ctrl+Shift+V, Shift+Insert and right-click in the input are also supported. Provider setup
fields accept text through the same shortcuts. A terminal that does not forward a shortcut cannot
deliver that key to Redcode; Alt+V lets you paste without changing its global keybindings.

See the [README](../README.md#get-started) for the first session and the [clients guide](clients.md) for CLI, Desktop and server commands.
