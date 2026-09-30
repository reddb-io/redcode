---
"@reddb-io/redcode": minor
---

`redcode acp` again accepts the governed RedSkills child Agent contract. A parent that sends `_meta.redskills.childAgent` with `session/new`, `session/load`, `session/resume` or `session/fork` gets the parent binding (version, parent session, worker and authority) back in the session response, in every prompt outcome including cancellation, and in every permission request of the turn. The child refuses to start with `invalid params` when the contract is malformed, when it inherits `GITHUB_TOKEN`, `GH_TOKEN` or any `REDSKILLED_*` variable, or when an MCP server points at redskilled, so GitHub and redskilled authority stay with the parent. Ordinary editor sessions are unchanged.
