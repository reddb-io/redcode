---
"@reddb-io/redcode": patch
---

Steer moved from Shift+Enter to Alt+Enter; Shift+Enter always inserts a newline. While the agent works, Alt+Enter delivers your prompt at its next step (Enter keeps queueing it); when the session is idle, Alt+Enter submits like Enter. Pressing it with an empty prompt still steers the latest queued prompt. An explicit `input_steer: "shift+return"` in `tui.json` is still honoured. macOS Terminal.app needs "Use Option as Meta key" and Windows Terminal needs its default `alt+enter` fullscreen binding removed; until then the busy hint points at `/steer <text>`, which works in every terminal.
