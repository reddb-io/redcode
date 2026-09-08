# TUI lifecycle benchmark

Run from `packages/tui`:

```sh
bun run bench:lifecycle --seconds 10
bun run bench:lifecycle --seconds 7200 --interval-ms 100 --stop-file /tmp/tui-soak.stop > /tmp/tui-soak.json 2> /tmp/tui-soak-progress.log
```

The harness mounts the real SDK/Sync providers and OpenTUI renderer against an isolated fixture transport. Every cycle remounts a consumer ten times, streams a 10 KB part into another session, dispatches a keyboard event, and renders a frame. It checks that one mounted consumer receives exactly one callback per event, every key is delivered, and inactive message/part caches remain at or below their bound. `--interval-ms` paces cycles for longer runs. Progress is emitted once a minute; the final JSON includes dispatch/render latency percentiles and sampled heap/RSS.

Use a fresh stop-file path for each run. Creating that file (or sending SIGINT/SIGTERM) stops at the next loop boundary and saves a partial result with `completed: false`, the requested duration, and the actual elapsed duration. A successful exit alone does not mean the entire requested soak completed. Ordinary tool-session lifetime depends on the host; stop explicitly and retain the JSON before closing the task when an unattended process is not wanted.

The legacy fixture disables buffering of its unused V2 SSE mirror. Keeping that unrelated buffer would make the benchmark retain all generated traffic and falsely attribute its memory growth to production caches.

No server, paid model, user database, or existing process is used. This measures this workload's event ownership, cache retention, and OpenTUI input/render path. It does not simulate provider latency, a browser export, every transcript layout, or the terminal emulator/compositor. Compare timings on the same host under similar load; heap/RSS samples include runtime allocation and garbage collection, so a short upward slope alone does not prove a leak.
