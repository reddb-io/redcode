---
"@reddb-io/redcode": patch
---

The TUI todo panel keeps the thread's work in view instead of its whole history: open tasks always show, while completed and cancelled ones stay only for 15 minutes after they closed (the store now stamps each task with `closedAt`) and then fall away.
