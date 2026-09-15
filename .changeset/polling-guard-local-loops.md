---
"@reddb-io/redcode-core": patch
"@reddb-io/redcode": patch
---

The sleep-polling guard now refuses wait loops around local checks, such as `until grep -q PASSED ci.log; do sleep 5; done`, when their total wait is 30 s or more or cannot be read off the command. Before, it only caught loops around remote status commands. The refusal suggests polling the check itself: every 1–2 s with a 2-minute deadline for an open-ended readiness loop, done when it exits 0, and it names any commands that came after the wait. A `while` condition is inverted so that exit 0 still means done. Batch loops that act on each item, and retries bounded under 30 s by a counter, an iteration count or `timeout`, still run.
