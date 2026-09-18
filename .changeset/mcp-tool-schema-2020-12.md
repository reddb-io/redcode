---
"@reddb-io/redcode": patch
---

Fix sessions failing with "no schema with key or ref https://json-schema.org/draft/2020-12/schema" when an MCP server publishes tool input schemas that declare a JSON Schema dialect redcode's validator does not register (the zod v4 default). The advisory `$schema`/`$id` keys are ignored before compilation, and a tool whose schema still cannot be compiled is now skipped with a warning instead of taking down every session of the project.

A broken MCP server can no longer take the session down either: failures and defects while registering one server (an invalid `url`, for example) are contained to that server, which stays paused with a warning while every other server keeps working.
