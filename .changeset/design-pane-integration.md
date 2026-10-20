---
"@reddb-io/redcode": patch
---

Design review now opens reliably in the desktop browser pane instead of falling back to the system browser: pending pane opens are queued until the pane attaches, closed Design tabs are reopened without muting the pane, and the pane routes through the same launch-claim as manual opens. Approving from the desktop panel now matches the review page (typed revision, HTML-aware Accept so an ended review renders a readable page instead of a bare 410), and panel notices are localized (en/br) with expandable round notes.
