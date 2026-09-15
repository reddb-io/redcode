---
"@reddb-io/redcode": patch
---

Design system detection no longer remembers "nothing detected" when it ran out of time, and a scan cut short is reported with at most 50% confidence. A design system one session adopted stays with that session until it is saved, so another session's failed design no longer takes it away. `design_document {"action":"detect"}` states that it only reads project files and never asks or writes, and the docs explain how `design.application` combines with `design.system` across config files.
