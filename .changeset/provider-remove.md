---
"@reddb-io/redcode": minor
---

Remove a provider completely from `/connect` (Manage → Remove provider, or ctrl+d on a connected provider), the web settings, or `redcode providers remove <id>`. Removal deletes the saved key or login and the provider's global configuration entry, clears the default, small, agent and command models, the enabled and disabled provider lists, System Two models and a System One evaluator that use it, and forgets its cached router detection and learned limits. A confirmation first shows what is in use, which project files still mention it and which environment variables would bring it back. Connecting a provider again takes it off `disabled_providers`, and `redcode providers list` now shows providers that are configured without a saved credential.
