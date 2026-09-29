---
"@reddb-io/redcode": patch
---

Explain why the background service failed to start instead of only reporting that it failed. The startup error, `redcode service status`, and the service's failed responses now carry a short redacted reason, the log file that holds the full cause, and the `redcode service restart` recovery command. Stop spawning new service processes once one fails to start, so a taken port or an invalid configuration is reported right away instead of retrying until the startup deadline.
