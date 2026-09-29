---
"@reddb-io/redcode": minor
---

Tasks now have a short title next to their full text. `todowrite` and `plan_exit` tasks take an optional `title` (one imperative line of up to 80 characters) while `content` keeps the whole task and its acceptance detail, which is what the model reads back in results, reminders and blockers and what the completion gate checks. A task without a title, including every task written before this version, is labelled with the first line of its content, cut at its first sentence or at 80 characters on whole characters, so accents, CJK and emoji are never split.

The sidebar Todo list shows one title line per task and at most one line of its reason, however long the model wrote them, instead of wrapping a long task over dozens of rows. Click a task to expand it in place with its full content, what it is done when, the reason, the request it came from and its evidence; click again to fold it. `redcode run` and the mini TUI print a task update as a single line of task titles, and any other tool whose input is not summarized is cut to one line instead of printing its whole input.
