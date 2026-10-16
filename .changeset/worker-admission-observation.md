---
"@reddb-io/redcode": patch
---

Confirm the original worker task admission and live execution before reporting running or releasing a checkout. Observe current workers through one metadata-only API snapshot, with compatible receipt checks for older workers. Retain the original placement and IDs across interrupted admissions and recover only on explicit request.

Explain missing admission, idle or suspended execution, lost observation and changed placement in the Desktop and web worker panel using the existing design system. Reject recovery of a Session moved away from its assigned checkout, preserve canonical SDK contracts and avoid rewriting unchanged observation journals.
