---
"@reddb-io/redcode": patch
---

Compaction no longer copies secrets pasted in chat into the checkpoint. `/compact` and automatic compaction redact API keys and tokens (OpenAI, Anthropic, OpenRouter, GitHub, GitLab, AWS, Google, Slack, Stripe, npm), JWTs, PEM private keys, `Authorization` headers, passwords in URLs and credential query parameters, and secret-named assignments such as `API_KEY=…`, `"password": "…"` or `token: …` before the summarizer reads the conversation, and again in the summary it writes, the quoted user requests, the file and identifier anchors, the verbatim recent part and the `/compact` focus. A redacted value reads as its kind, such as `[redacted:github-token]`, and the summary prompt tells the model to name a credential by what it is instead of repeating it. Session titles are generated from, and saved as, redacted text too.

Checkpoints written by earlier versions keep what they copied in their stored history, which is left as it is; they are redacted as they are read into a model request and when the TUI and the app show them, and a later compaction no longer carries their anchors forward unredacted. The original messages stay in the session and were already sent to the provider, so rotate anything you pasted.

A failed service boot's reason masks credentials with the same kinds instead of `***`.
