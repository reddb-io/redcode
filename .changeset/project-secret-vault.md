---
"@reddb-io/redcode": minor
---

Secrets you paste into a conversation are moved into a per-project vault before the message is stored, and the model only ever sees a reference such as `{vault:github-token-1}`. Known token families (GitHub, GitLab, OpenAI, Anthropic, OpenRouter, AWS, Google, Slack, Stripe, npm), JWTs, PEM private keys, passwords in URLs, credential query parameters and literal values under secret names such as `API_KEY=…` are replaced in the prompt text, in queued and steered prompts, in text attachments and in the `/compact` focus; mentions keep pointing at the right text. Long random-looking strings that might be hashes are left as they are. A secret belongs to the session's project, which all worktrees of a repository share, and no other project can see or use it.

The shell tool passes a vaulted value to the command through an environment variable set only for that process, so the command you approve, the stored tool call and the process list show the reference. `webfetch` URLs and MCP tool arguments resolve references in process when the call runs. No other tool resolves them. Tool results, shell output, background shell notifications, tool errors and the output of commands you run with `!` have every vaulted value of the project replaced by its reference before they are stored or sent to the model.

The TUI shows a notice under the protected message and a toast, and `/vault` lists the names and kinds in the current project's vault and forgets an entry. Values are never shown. In this release the vault is kept in memory and is emptied when the service restarts. Anything you sent before it was vaulted stays in your history and with your provider, so rotate it.
