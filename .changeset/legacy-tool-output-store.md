---
"@reddb-io/redcode": patch
---

Legacy sessions now bound oversized tool output through core's `ToolOutputStore` instead of the runtime's own `Truncate` service, so both runtimes share one Managed Tool Output directory, one file naming scheme, one head-and-tail bounding policy and one retention scan. The model-visible notice is the store's `... output truncated; full content saved to <path> ...` between the head and the tail of the output, followed by the instruction to Grep or Read the saved file with offset/limit rather than whole; the previous Task-tool delegation hint is gone. Limits still come from `tool_output` in Redcode config, the managed directory stays readable for every agent, and a storage failure still yields a lossy bounded output without a path (warning logged) rather than a failed tool call, now for streamed shell output too. Managed files are still deleted by age after seven days.
