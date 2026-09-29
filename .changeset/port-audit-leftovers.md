---
"@reddb-io/redcode": minor
---

Close a batch of V1 port leftovers.

- `redcode run` and the mini TUI work in the real working directory instead of a possibly stale `PWD`. With a prompt in the arguments, `redcode run` waits at most two seconds for piped input to start, so a wrapper that never closes stdin no longer hangs it; piped data that starts in time is still read in full, and a run whose only prompt is stdin still reads it to the end.
- The ACP agent introduces itself as Redcode and offers `redcode auth login` (method `redcode-login`, as in V1). Updater messages and the GitHub agent's footer and logs name Redcode.
- `--reasoning single|dual` on `redcode`, `redcode run` and `redcode serve` overrides the saved reasoning mode for that invocation, like `REDCODE_REASONING`. Outside `serve` it requires `--standalone`, since the shared background service keeps its own mode.
- Form field descriptions, such as the plan under approval, render as Markdown like the transcript.
- `design.gate: true` makes Design approval wait for a completed layout audit of the published revision at every configured viewport class, and `design.viewports` (`mobile`, `compact`, `desktop`) narrows the classes the audit covers. Both are off by default.
- When the server listens beyond loopback, the Design review notices in the TUI and `redcode design` also give the review's address for another device on the network.
- `REDCODE_DISABLE_WHITEBOARD_DOWNLOAD=1` stops the whiteboard bundle download again; the whiteboard then reports itself unavailable with the reason.
- TUI plugin cleanups and TUI exit disposal stop waiting after two seconds, and an npm plugin install that does not finish within five minutes fails with a clear error instead of holding the install lock.
