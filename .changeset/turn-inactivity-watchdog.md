---
"@reddb-io/redcode": patch
---

End a turn that has stopped producing anything, where nobody is watching to end it themselves. Time a tool spends running or a permission spends awaiting an answer does not count as silence, so a long build is never mistaken for a provider that went away. In the TUI and the desktop app the turn is reported rather than ended, since a person is there to read it and press escape; a scripted run, an editor speaking ACP or a scheduled job ends it. Configurable through `experimental.turn_stall`, or `false` to disable.
