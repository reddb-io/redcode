---
"@reddb-io/redcode": patch
---

Fix LSP recovery from rejected NODE_OPTIONS, including Biome startup with --user-system-ca. Keep retries isolated per server, preserve quoted options, and monitor the successfully restarted process instead of the exited original.
