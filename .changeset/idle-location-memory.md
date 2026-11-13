---
"@reddb-io/redcode": patch
---

Keep idle project services asleep after server shutdown notifications instead of reopening their model, agent and MCP catalogs from late events. Preserve cached catalogs until an explicit read reopens the project, stop background events from prolonging project cache retention, and record lightweight server heap, native memory and event queue samples in bounded diagnostic logs.
