---
"@reddb-io/redcode": patch
---

Removing a provider now sticks. A provider that the environment would load again (for example through `ANTHROPIC_API_KEY`) is hidden through `disabled_providers`, and the removal says which variables would have brought it back; connecting it again shows it. Hidden providers stay in the connect list so they can be connected again.

OpenCode Zen and Amazon Bedrock are now opt-in. OpenCode Zen loads only with an API key (environment, saved or configured) or a `provider.opencode` entry in the configuration, and no longer appears on its own with the public key. System One's "OpenCode Zen — Jev Free" transport is unchanged. Amazon Bedrock no longer loads just because AWS credentials are present in the environment or `~/.aws`: connect it to import an AWS profile (including SSO profiles) or the AWS credentials in the environment, with a region, or to save a Bedrock API key. A `provider.amazon-bedrock` configuration entry keeps working as before.
