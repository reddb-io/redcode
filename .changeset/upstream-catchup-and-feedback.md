---
"@reddb-io/redcode": patch
---

Catch up with upstream fixes we were missing and make a running turn legible: the footer now says what the assistant is doing (thinking, editing a file, running a command) instead of showing a bare spinner; language servers that die because the environment exports a Node flag they refuse are restarted without it; stalled streams, unrecognised gateway errors and `network_error` finishes are retried instead of losing the turn; `gpt-5.x` works through OpenAI-compatible gateways again; a failed subagent reports its failure instead of returning nothing; `redcode run` answers permission requests raised by subagents; config writes stop erasing keys the schema does not model; and the whole workspace's tests now run in CI, not just four packages.
