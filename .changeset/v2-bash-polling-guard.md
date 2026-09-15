---
"@reddb-io/redcode-core": patch
"@reddb-io/redcode": patch
---

The v2 core `bash` tool (used by `redcode design`) now refuses sleep polling loops, blocking watchers and long sleeps before asking or running. Without monitors in v2, the refusal offers a single status check to run now and report, or a bounded wait under 30 s. The detector moved to `@reddb-io/redcode-core/tool/shell-polling` and the legacy shell tool uses it unchanged.
