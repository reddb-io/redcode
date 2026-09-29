---
"@reddb-io/redcode": minor
---

OpenCode Zen and Amazon Bedrock are opt-in again. A fresh install no longer loads OpenCode Zen's free tier through the public key, so no free Zen model becomes the default and the first prompt no longer fails with a Zen free-tier error. OpenCode Zen loads with an API key (environment, saved or configured), a connected Console account, or a `providers.opencode` (V1: `provider.opencode`) entry in the configuration; a bare entry still opts into the free models. Amazon Bedrock no longer loads just because AWS credentials are present in the environment or `~/.aws`: connect it with a Bedrock API key (saved or `AWS_BEARER_TOKEN_BEDROCK`), or add a `providers.amazon-bedrock` entry or a configured `profile`. System One's "OpenCode Zen — Jev Free" transport is unchanged.

With no provider connected, sending a prompt in the TUI explains that none is connected and opens the connect dialog, and `redcode run` stops before creating a session with "No provider connected. Run `redcode` and use /connect, or set a provider key". When the default model is not configured, a model reached only through an anonymous free tier is chosen only if no connected provider offers one.
