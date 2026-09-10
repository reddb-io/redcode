---
"@reddb-io/redcode": patch
---

Report preview assembly failures from the TUI Design server as actionable errors instead of opaque HTTP 500 responses. Show the failure in the preview canvas, disable actions against a failed preview, stop repeated polling retries, and retain the selected revision when explicitly retrying with Refresh.
