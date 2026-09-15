---
"@reddb-io/redcode": patch
---

Stop config loading from trying to install the unpublished `@reddb-io/redcode-plugin` package, which logged a 404 on every run. Config directories now only install dependencies they declare in their own `package.json`. Retry status no longer shows OpenCode Go upsell messages or opencode.ai links; usage-limit errors show the provider's own message.
