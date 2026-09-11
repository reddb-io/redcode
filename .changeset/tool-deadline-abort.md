---
"@reddb-io/redcode": patch
---

Stop the tool a deadline fires on, and keep truncated output when its file cannot be written

A tool that outlives its deadline is now handed an aborted `ctx.abort`, joined
to the turn's own signal, so tools that honour it actually end instead of
running on after the model was told they failed. Truncated tool output whose
full text cannot be retained (unwritable directory, full disk) is now returned
as a bounded, explicitly lossy result without an output path, and the storage
failure is logged, instead of failing a tool call that had already succeeded.
