---
"@reddb-io/redcode": patch
---

Interrupting a Claude harness run leaves it interrupted instead of failed with "Claude execution failed", and the next instruction runs normally. Harness processes no longer inherit the bridge, notes or remote session identity and access token of a Claude Code session that launched Redcode.
