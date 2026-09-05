---
"@reddb-io/redcode": patch
---

Design mode: the session's end is written down, and a closed session's prototypes stop being served

When a turn ends, `design.json` records which revision it ended on, so a design reopened later knows where it stopped. When a session is deleted its prototypes stop being reachable — before, nothing ever released them. And `design_preview` says when the review window has not checked in for a while, so the agent knows it may be talking to nobody. Also fixes prototype ids, which were the first sixteen bytes of `session:path` and therefore the same for every prototype on a machine.
