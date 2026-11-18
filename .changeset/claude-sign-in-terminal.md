---
"@reddb-io/redcode": patch
---

Claude sign-in now stays in Anthropic's own flow: Agent setup shows the `claude auth login` command to run in a terminal on the host instead of relaying the sign-in. Check installation shows whether a Claude instance uses a subscription (with its plan) or an API key, which takes precedence and is billed separately. Claude and Codex harnesses no longer inherit the session variables of a Claude Code session that launched Redcode.
