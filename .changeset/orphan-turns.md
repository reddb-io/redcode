---
"@reddb-io/redcode": patch
"@reddb-io/redcode-app": patch
---

Close turns left open by a process that died, and stop calling them a queue

`time.completed` on an assistant message is written by the process running the turn. Killed mid-turn — an OOM, a machine going to sleep — nobody writes it, and the message stays open for the rest of the session's life. The TUI reads an open assistant message as a turn in progress and stamps QUEUED on everything typed after it, across restarts, with nothing running: a session that survived one crash looks jammed forever. A fresh run now closes anything left behind by a run that is gone, records it, and the QUEUED badge requires the session to actually be busy.
