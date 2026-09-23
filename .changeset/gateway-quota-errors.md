---
"@reddb-io/redcode": patch
---

Exhausted accounts are no longer retried as if they were rate limits. HTTP 402 and gateway account caps such as OpenCode Zen's free-tier and credit limits, `insufficient_quota`, usage limits and OpenRouter credit errors now stop the turn at once with a message saying the account's quota, credits or free-tier limit is exhausted, instead of retrying for minutes. Content-policy refusals are not retried either, and a 4xx rejection whose body carries a gateway's substituted `server_error` code is no longer retried.
