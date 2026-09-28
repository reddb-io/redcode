---
"@reddb-io/redcode": patch
---

Preserve conversation history when a V2 compaction checkpoint is incomplete or fails to reduce context. Accept a complete checkpoint when the provider stops at its output limit. Carry bounded user and file anchors across summaries and pause automatic compaction after repeated ineffective checkpoints, with the pause stored in session metadata.
