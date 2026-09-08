# Design terminal

`redcode design` starts an interactive terminal session using the same SessionV2
API and runner as the App. A local server runs in a separate Worker and also
serves the browser review surface, so backend work does not occupy the terminal
input thread.

```sh
redcode design "Explore the settings screen"
redcode design --agent plan --model provider/model
redcode design --session ses_existing_v2
redcode design --attach http://127.0.0.1:4096 --session ses_existing_v2
```

Use `/review` to open the browser, `/mode design|plan|build` to explicitly change
the session agent, and `/model provider/model` to change its model. Adopting an
existing session preserves the server's agent and model; startup flags apply to
new sessions. Adoption and event reconnection never resume provider work.
`/resume`, a new message, or `/goal-resume` is an explicit request to continue.

Messages steer at provider boundaries. `/queue message` waits until current work
would otherwise become idle. `/stop` or Ctrl+C interrupts execution without
closing the terminal. `/quit` exits; a local server interrupts its session before
shutdown, while detaching from a remote server leaves its execution running.

The terminal shows pending permission and question requests without granting
them automatically. `/allow request-id once|always|reject` answers permissions.
`/answer request-id 1; 2,3` answers questions in order, using option numbers and
semicolons between questions. Free text is accepted only when the question permits
it. `/reject request-id` rejects a question request.

`/goal objective` starts a Goal; `/goal-status`, `/goal-pause`, `/goal-resume`,
`/goal-budget N`, and `/goal-drop` use the current SessionV2 contract. `/status`
shows the authoritative mode, activity, Goal budget and pending requests.

History is read in bounded pages and events reconnect from the last durable
sequence. Only the cursor and current control state remain in memory. Completed
text and tool output are printed as durable events arrive; this initial terminal
surface does not render provisional token deltas. Terminal control sequences are
removed from model/tool output.

Status snapshots are fenced against newer requests and incoming events. Closing
the terminal aborts its HTTP requests and event stream; local worker shutdown is
bounded and ends with Worker termination. Failed startup restores readline's
previous raw-input state before propagating the error.

This is a separate interactive terminal surface. The existing full-screen TUI
still uses its legacy renderer and history model. Its existing conversations are
not silently converted or replaced by starting Design. `--session` identifies a
V2 session; use the original TUI to continue legacy sessions.

Native releases prepare a versioned Design tool cache under
`~/.red/code/cache/design-runtime/` on the first React/Solid build or browser
export. Vite, its plugins, Playwright and Axe use exact package versions and
remain real packages so their native libraries and browser resources can load.
This first setup requires registry access; later uses reuse the cache. Package
setup has a five-minute deadline and reports its cache path on failure. A
checkout uses its installed workspace dependencies without this download.

The first browser export also installs Chromium into Playwright's browser cache
if it is absent. This subprocess runs the CLI's embedded Bun runtime, has a
three-minute deadline, and is interrupted when the export is cancelled. Existing
Chromium installations are reused; `PLAYWRIGHT_BROWSERS_PATH` can select a
preinstalled browser cache. HTML browser review itself needs neither the build
tool download nor Chromium.
