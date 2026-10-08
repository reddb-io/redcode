# Project secrets

By default, Redcode keeps each repository's secrets in its git-ignored `.env`. Worktrees of the same repository share that project vault; other repositories do not receive its secrets. Agents see `{vault:name}` references instead of values. Captured tool-output secrets stay in process memory.

Declining a secret request stops the current execution. Send a new message to continue; Redcode does not automatically ask again after the refusal.

Use `redcode vault disable` or `redcode vault enable` to control automatic vault handling for the current repository. The commands find the repository root even from a subdirectory and preserve existing JSONC comments and unrelated settings.

Add `--global` to either command to explicitly write the default for all repositories. A repository setting overrides that default. The equivalent setting is `"vault": false` or `"vault": true` in an existing Redcode configuration file; if omitted, project `.env` handling remains enabled. This global setting controls the feature and does not share secret values between repositories.

Disabling removes the request tool and vault guidance and stops automatic capture of new secrets from prompts and tool outputs. Existing project secrets remain stored and redacted in model requests and tool results. Explicit `vault set` and `vault import` remain available to manage the project `.env`.

Configuration changes are watched. Use `redcode reload` to force a refresh if needed. A request that is already open can be declined to stop its execution.
