---
"@reddb-io/redcode": patch
---

Fix `--yolo` silently disabling the loop guard. Yolo's blanket permission allow no longer counts as an explicit `doom_loop: allow` rule, so a session that keeps calling the same read-only tool with the same result still corrects and then stops the turn instead of repeating forever. The loop guard's correction message also now tells the model to stop polling and ask the user for the action it is waiting on, instead of just naming "change the arguments" as the only way out.
