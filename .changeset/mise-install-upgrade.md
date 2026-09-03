---
"@reddb-io/redcode": patch
---

Recognize Redcode installs managed by mise (`github:reddb-io/redcode`, the way red-dev installs it) so the update prompt and background auto-update upgrade through mise instead of failing with "Unknown installation method", and show the real reason in the TUI when an update fails.
