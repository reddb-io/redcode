---
"@reddb-io/redcode": patch
---

Model suggestions never point at a model that is out of quota. With RedRouter MCP schema 4 every candidate must be `usable` (an account free for that exact model) and never `quota_exhausted`; older routers also drop rate limited, failing or disabled candidates. While the current model is out of quota, an equivalent is suggested before the next failure, never from the same exhausted model or provider, and the card shows "quota until <local time>". Switching asks the router again first: if the suggested model has become unusable, the card says it is no longer available and the model does not change.
