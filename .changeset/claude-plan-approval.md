---
"@reddb-io/redcode": patch
---

Claude approval requests are readable: a plan proposed in plan mode shows as the plan itself and a command as the command, instead of raw tool input. Approving the plan records that the run left plan mode, so a resumed run does not return to it.
