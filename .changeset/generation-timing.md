---
"@reddb-io/redcode": minor
---

Latency and output speed measure the model again, not the work around it.

- **Output speed counts only generation.** The rate is output plus reasoning tokens over the window from the first non-empty token (text, reasoning, tool input, or a tool call without streamed input) to the last one before the step finished. Tool runs, permission prompts, snapshots and hooks no longer count: a step that wrote 120 tokens in half a second and then ran a test suite for 1.5 seconds showed about 60 tk/s and now shows about 250 tk/s.
- **Latency starts when the request goes out.** Time to first token is measured from immediately before the provider call to the first non-empty token, per attempt, so local preparation (tools, MCP, snapshots, plugins, auth) and a failed attempt before a retry are left out. An empty `reasoning-start` or block opening no longer counts as the first token. The context tab also shows the time to the first visible token and the local preparation separately.
- **No number when there is nothing to measure.** A step whose tokens arrived in one or two deliveries (a non-streaming proxy) shows `burst` instead of the local write speed, and fewer than 20 tokens or a window under 300 ms shows no rate. Compaction summaries, which replay collected events, are skipped by both the TUI and the app, and so are messages recorded before this release: their numbers counted tool runs.
- **Live and per turn.** Latency is written as soon as the first token arrives, so it shows while the step streams; a finished or aborted step's values are dimmed. When a turn has more than one step, the TUI sidebar and the app's context tab also show the turn's speed (total tokens over total generation time) and the latency of its first step. The app formats numbers in the selected language.
- **Reasoning counted apart from output.** Usage where reasoning exceeds output (xAI-style, often forwarded by proxies) no longer reports zero output tokens; reasoning is added to output instead of subtracted from it.

Assistant messages gain an optional `timing` object (`requestStarted`, `firstToken`, `firstVisible`, `lastToken`, `prepMs`, `ttftMs`, `visibleMs`, `genMs`, `tokens`, `burst`, `replayed`); durations come from a monotonic clock. `time.first` is still written for older clients.
