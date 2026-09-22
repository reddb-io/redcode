# Voice input

The TUI exposes a local, process-scoped sink for structured dictation. A compatible client can send `start`, `partial`, `commit`, `finish` and `cancel` events to the active composer. `partial` text is replaceable, committed segments accumulate, and `finish` leaves the result as an editable draft. Voice input never calls `SessionV2.prompt` or submits the composer.

On Unix, each TUI registers a Unix socket under `$XDG_RUNTIME_DIR/redcode-<uid>/voice-input/`, falling back to `/tmp` when no runtime directory is available. The containing directory is mode `0700`; the registry and socket are mode `0600`. The registry carries a random capability required on every event, the TUI PID, terminal path and optional zellij session and pane identifiers. The registry and socket are removed when the TUI exits. Stale registrations are ignored by clients when their process no longer exists.

[dit](https://github.com/reddb-io/dit) selects the sink only when it can associate exactly one TUI with the focused terminal process tree or focused zellij session. An unavailable or ambiguous sink preserves dit's keyboard, clipboard or zellij fallback. After a sink accepts `start`, delivery remains pinned to it for the recording; a later failure cannot inject the remaining text into another focused application.

Windows currently keeps dit's existing input injection behavior. A named-pipe transport can implement the same event contract later.
