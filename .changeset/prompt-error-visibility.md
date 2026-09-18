---
"@reddb-io/redcode": patch
---

Make prompt failures visible and survivable. Model resolution now retries transient provider-catalog failures (network, models.dev fetch) a couple of times before giving up, and publishes the provider's real message as a session error when resolution fails — instead of dying with an opaque defect that rendered as "unexpected server error. check server logs for details." with nothing behind it. The /api server also logs every uncaught defect with an `err_xxxxxxxx` ref (and returns the ref in the 500 body), so an intermittent failure is diagnosable from the logs.
