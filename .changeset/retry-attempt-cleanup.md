---
"@reddb-io/redcode": patch
---

Discard a failed provider attempt's parts before retrying and never retry past an executed tool

When a stream failed with a retryable error, the parts it had already persisted (text,
reasoning, step-start, tool parts) stayed in the assistant message and the retried stream
appended duplicates next to them. The processor now removes what the failed attempt wrote
as soon as a retry is decided, so the message holds one copy of the answer. A failure after a
tool call already ran is no longer retried at all: replaying the request would execute the
tool a second time, so the error is surfaced as a normal terminal failure instead.
