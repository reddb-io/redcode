---
"@reddb-io/redcode": patch
---

Preserve the latest original user request across repeated context compactions in both runtimes. Reject unfinished, truncated, empty or non-shrinking summaries before they replace active history, and keep legacy history visible until checkpoint validation completes. Share summary instructions that preserve user constraints, approval scope and verified work state.
