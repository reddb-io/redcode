---
"@reddb-io/redcode": patch
---

Prioritize native session details on mobile, with persistent navigation back to the session picker and a shortcut to pending agent requests. Keep setup forms out of the detail view, bound the inspector to available workspace space, and collapse long output and execution controls on narrow screens.

Preserve unsent instructions and question answers when reopening the same session, clear them when selecting another run, pause detail polling while the inspector is closed, and retain output scroll position across metadata refreshes. Returning to the picker never stops the owned process.
