---
"@reddb-io/redcode": minor
---

The app's side menu now shows one status per session, in a fixed priority: Needs approval, Needs input, Working (a subtle pulse and the elapsed time), Queued, Failed, then Done for a finished turn you have not viewed yet. Each project row rolls up the most urgent status of its sessions, so a collapsed project still shows that it needs you. Rows waiting on you keep full ink while idle and seen rows stay quiet, and **Next session needing you** (`Alt+Shift+Down`) jumps to the most urgent one. Themes gain `v2-status-*` color roles for these marks.
