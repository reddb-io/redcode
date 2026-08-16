---
"opencode": patch
---

Apply a provider block's `npm` to every model of that provider, not only to models the same block redeclares. A config that set `npm` together with `options.baseURL` but declared no `models` had its `npm` silently ignored while the `baseURL` was applied, so the catalog's SDK was paired with the configured host — for example the Anthropic `/v1/messages` path sent to an OpenAI-compatible host, which 404s. Omitting `npm` still keeps the catalog package while overriding the host, and a per-model `provider.npm` still wins over the provider-level value.
