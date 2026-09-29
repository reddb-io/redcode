---
"@reddb-io/redcode": minor
---

Restore the V1 compaction controls on the V2 runtime. `/compact <focus>` steers the summary in the TUI and the web app: the focus travels with the compaction request (`focus` on `POST /api/session/:sessionID/compact`) and the summary gives it the most detail. A later `/compact` that joins a pending one keeps the first focus, and requests queued before this release still run.

The recent history kept verbatim beside a summary now scales with the window: a tenth of the usable context, between 8k and 60k tokens and never more than a quarter of a small window, instead of a fixed 15k (`compaction.keep.tokens` still sets it exactly). A huge pasted request no longer rides every later request whole: once it exceeds its share it is kept as a head and tail around a `[middle elided: N tokens]` marker, and when the provider refuses a summary request whose newest exchange alone is too large, that exchange is sent the same way instead of failing the compaction.

When less than 5% of the context is left and automatic compaction is off or paused, the model gets one chronological reminder to finish the current step and hand off cleanly; it drops out once a compaction frees room.

Add `compaction.background` (off by default): shortly before the threshold, the summary is prepared beside the running step and committed at the next step boundary that needs it, as long as the history it covers is unchanged. Preparation never writes a checkpoint, is cancelled when the session goes idle, and its usage is billed as compaction.
