---
"@reddb-io/redcode": patch
"@reddb-io/redcode-core": patch
---

Ported from upstream: Azure CLI authentication, Codex model filtering, Copilot session header, GitLab provider bump

Azure can authenticate through the Azure CLI, without a Bun dependency, and its model discovery is gone (it logged to stdout and added nothing); Codex accepts integer GPT versions and compares them by major and minor; GitHub Copilot sends the interaction id with the session; `gitlab-ai-provider` 6.13.0.
